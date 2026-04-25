import {
  resolveAssistantFieldPresentation,
  type RpaActionDefinition,
  type RpaFlowDefinition,
  type RpaStepDefinition,
} from '@uniflow/shared-types';
import {
  BrowserStepRepairEngine,
} from '@uniflow/compat-engine';
import { BrowserEngineFactory } from './browser-engine-adapter';
import { BrowserActionExecutor } from './browser-action-executor';
import { BrowserRecoveryManager } from './browser-recovery-manager';
import { BrowserSecurityPolicy } from './browser-security-policy';
import { BrowserSessionManager } from './browser-session-manager';
import { ElementRefCache } from './element-ref-cache';
import { PageSnapshotGenerator } from './page-snapshot-generator';
import type {
  BrowserSessionRecord,
  BrowserTabRecord,
  BrowserTaskRequest,
  BrowserTaskRunResult,
} from './browser-runtime.types';

interface AdaptiveExecutionScope {
  regionId?: string;
  formId?: string;
  frameUrl?: string;
  anchorElementRef?: string;
}

export class BrowserTaskRuntime {
  private readonly sessionManager = new BrowserSessionManager();
  private readonly securityPolicy = new BrowserSecurityPolicy();
  private readonly refCache = new ElementRefCache();
  private readonly snapshotGenerator = new PageSnapshotGenerator(this.refCache, this.securityPolicy);
  private readonly recoveryManager = new BrowserRecoveryManager(this.snapshotGenerator, this.refCache);
  private readonly stepRepairEngine = new BrowserStepRepairEngine();
  private readonly engineFactory = new BrowserEngineFactory();

  async run(request: BrowserTaskRequest): Promise<BrowserTaskRunResult> {
    const requestedProvider = request.runtime.browserProvider || 'stub';
    const engineSelection = this.engineFactory.create(requestedProvider);
    const session = this.sessionManager.createSession(
      request,
      engineSelection.adapter.provider,
      requestedProvider,
      engineSelection.warnings,
    );
    const tab = this.sessionManager.getActiveTab(session);
    const actionExecutor = new BrowserActionExecutor(engineSelection.adapter, this.refCache, this.securityPolicy);
    const executedSteps: BrowserTaskRunResult['executedSteps'] = [];
    const recoveryAttempts: BrowserTaskRunResult['recoveryAttempts'] = [];
    const snapshots: BrowserTaskRunResult['snapshots'] = [];
    const adaptiveStepPlans = new Map<string, RpaStepDefinition>();
    let activeScope: AdaptiveExecutionScope | null = null;
    let currentSnapshot = undefined as BrowserTaskRunResult['finalSnapshot'];
    let success = true;
    let errorMessage: string | undefined;

    try {
      await engineSelection.adapter.initialize(session, tab);
      currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
      snapshots.push(currentSnapshot);
      activeScope = this.refineActiveScopeFromSnapshot(currentSnapshot, activeScope);

      const actionDefinition = this.getActionDefinition(request.flow, request.action);
      const steps = (actionDefinition?.steps || []).slice(0, request.runtime.maxSteps || 50);

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const executableStep = await this.planExecutableStep(
          step,
          adaptiveStepPlans,
          activeScope,
          currentSnapshot,
          request,
        );

        try {
          const execution = await actionExecutor.executeStep(
            session,
            tab,
            executableStep,
            index,
            currentSnapshot.snapshotId,
          );
          executedSteps.push(execution.stepResult);
          activeScope = this.deriveExecutionScope(execution.stepResult, currentSnapshot) || activeScope;

          if (execution.extractedValues) {
            Object.assign(tab.extractedValues, execution.extractedValues);
          }

          if (execution.refreshSnapshot) {
            currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
            snapshots.push(currentSnapshot);
            activeScope = this.refineActiveScopeFromSnapshot(currentSnapshot, activeScope);
          }
        } catch (error: any) {
          const lastObservedSnapshot = currentSnapshot;
          const recovery = this.recoveryManager.attemptRecovery(
            session,
            tab,
            index,
            executableStep,
            error.message || 'unknown_browser_error',
          );
          recoveryAttempts.push(recovery.attempt);
          currentSnapshot = await this.captureRecoverySnapshot(
            engineSelection.adapter,
            session,
            tab,
            recovery.snapshot,
          );
          snapshots.push(currentSnapshot);
          const reasoningSnapshot = this.selectRecoveryReasoningSnapshot(
            lastObservedSnapshot,
            currentSnapshot,
            recovery.snapshot,
          );

          if (this.canSkipFailedTextNavigationStep(executableStep, reasoningSnapshot, request)) {
            executedSteps.push({
              index,
              type: executableStep.type,
              selector: executableStep.selector,
              fieldKey: executableStep.fieldKey,
              status: 'recovered',
              value: executableStep.value,
              description: executableStep.description,
              targetKind: executableStep.target?.kind || (executableStep.selector ? 'selector' : undefined),
              snapshotId: reasoningSnapshot?.snapshotId || currentSnapshot.snapshotId,
            });
            continue;
          }

          let stepErrorMessage = error.message || 'unknown_browser_error';

          if (recovery.attempt.recovered && this.canRetryFailedStep(executableStep, reasoningSnapshot)) {
            try {
              const retried = await actionExecutor.executeStep(
                session,
                tab,
                executableStep,
                index,
                reasoningSnapshot?.snapshotId || currentSnapshot.snapshotId,
              );
              executedSteps.push({
                ...retried.stepResult,
                status: 'recovered',
              });
              activeScope = this.deriveExecutionScope(retried.stepResult, reasoningSnapshot) || activeScope;

              if (retried.refreshSnapshot) {
                currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
                snapshots.push(currentSnapshot);
                activeScope = this.refineActiveScopeFromSnapshot(currentSnapshot, activeScope);
              }
              continue;
            } catch (retryError: any) {
              stepErrorMessage = retryError.message || stepErrorMessage;
            }
          }

          const repairOutcome = reasoningSnapshot
            ? await this.attemptStepRepairLoop({
                actionExecutor,
                engine: engineSelection.adapter,
                session,
                tab,
                index,
                step,
                effectiveStep: executableStep,
                request,
                initialSnapshot: reasoningSnapshot,
                recoveryAttempts,
                executedSteps,
                snapshots,
                adaptiveStepPlans,
                initialErrorMessage: stepErrorMessage,
                maxRepairRounds: Math.max(1, Math.min(request.runtime.maxRetries || 2, 2)),
              })
            : null;

          if (repairOutcome?.recovered) {
            currentSnapshot = repairOutcome.currentSnapshot || currentSnapshot;
            activeScope = this.refineActiveScopeFromSnapshot(
              currentSnapshot,
              repairOutcome.activatedScope || activeScope,
            );
            continue;
          }

          if (repairOutcome?.currentSnapshot) {
            currentSnapshot = repairOutcome.currentSnapshot;
          }

          if (repairOutcome?.errorMessage) {
            stepErrorMessage = repairOutcome.errorMessage;
          }

          errorMessage = stepErrorMessage;

          executedSteps.push({
            index,
            type: executableStep.type,
            selector: executableStep.selector,
            fieldKey: executableStep.fieldKey,
            status: 'failed',
            value: executableStep.value,
            description: executableStep.description,
            targetKind: executableStep.target?.kind || (executableStep.selector ? 'selector' : undefined),
            snapshotId: reasoningSnapshot?.snapshotId || currentSnapshot.snapshotId,
            errorMessage: stepErrorMessage,
          });

          if (!executableStep.continueOnError) {
            success = false;
            break;
          }
        }
      }
    } finally {
      await engineSelection.adapter.dispose(session);
    }

    return {
      success,
      errorMessage,
      sessionId: session.sessionId,
      provider: session.provider,
      requestedProvider: session.requestedProvider,
      snapshots,
      finalSnapshot: this.cloneSnapshot(snapshots[snapshots.length - 1]),
      executedSteps,
      recoveryAttempts,
      warnings: session.warnings,
      extractedValues: tab.extractedValues,
    };
  }

  private canSkipFailedTextNavigationStep(
    step: RpaStepDefinition,
    snapshot: BrowserTaskRunResult['finalSnapshot'],
    request: BrowserTaskRequest,
  ) {
    if (!snapshot || step.type !== 'click' || step.target?.kind !== 'text') {
      return false;
    }

    const formDataKeys = Object.keys(request.payload.formData || {});
    if (formDataKeys.length === 0) {
      return false;
    }

    const requestedFields = this.collectRequestedFieldDescriptors(request, formDataKeys);
    const snapshotFields = this.collectSnapshotFieldDescriptors(snapshot, request.flow.processCode);
    const hasAllFormFields = requestedFields.length > 0
      && requestedFields.every((field) =>
        snapshotFields.some((candidate) => this.matchesFieldDescriptor(field, candidate)),
      );
    if (!hasAllFormFields) {
      return false;
    }

    const pageTexts = this.collectSnapshotTexts(snapshot);
    return pageTexts.some((value) =>
      this.matchesSnapshotText(value, request.flow.processName)
      || this.matchesSnapshotText(value, step.target?.value),
    );
  }

  private getActionDefinition(flow: RpaFlowDefinition, action: 'submit' | 'queryStatus'): RpaActionDefinition | undefined {
    return action === 'submit'
      ? flow.actions?.submit
      : flow.actions?.queryStatus;
  }

  private async captureSnapshot(
    engine: ReturnType<BrowserEngineFactory['create']>['adapter'],
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
  ) {
    const pageCapture = await engine.capturePage(session, tab);
    tab.artifacts.lastPageCapture = pageCapture;
    return this.snapshotGenerator.generate(session, tab, pageCapture);
  }

  private cloneSnapshot(snapshot: BrowserTaskRunResult['finalSnapshot']) {
    if (!snapshot) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(snapshot));
  }

  private selectRecoveryReasoningSnapshot(
    lastObservedSnapshot: BrowserTaskRunResult['finalSnapshot'],
    recoverySnapshot: BrowserTaskRunResult['finalSnapshot'],
    syntheticRecoverySnapshot: BrowserTaskRunResult['finalSnapshot'],
  ) {
    if (
      recoverySnapshot
      && syntheticRecoverySnapshot
      && recoverySnapshot.snapshotId !== syntheticRecoverySnapshot.snapshotId
    ) {
      return recoverySnapshot;
    }

    return lastObservedSnapshot || recoverySnapshot;
  }

  private async attemptStepRepairLoop(input: {
    actionExecutor: BrowserActionExecutor;
    engine: ReturnType<BrowserEngineFactory['create']>['adapter'];
    session: BrowserSessionRecord;
    tab: BrowserTabRecord;
    index: number;
    step: RpaStepDefinition;
    effectiveStep: RpaStepDefinition;
    request: BrowserTaskRequest;
    initialSnapshot: BrowserTaskRunResult['finalSnapshot'];
    recoveryAttempts: BrowserTaskRunResult['recoveryAttempts'];
    executedSteps: BrowserTaskRunResult['executedSteps'];
    snapshots: BrowserTaskRunResult['snapshots'];
    adaptiveStepPlans: Map<string, RpaStepDefinition>;
    initialErrorMessage: string;
    maxRepairRounds: number;
  }) {
    let reasoningSnapshot = input.initialSnapshot;
    let currentSnapshot = input.initialSnapshot;
    let latestErrorMessage = input.initialErrorMessage;
    const attemptedRepairs = new Set<string>();

    for (let round = 0; round < input.maxRepairRounds; round += 1) {
      if (!reasoningSnapshot) {
        break;
      }

      const repairJudgement = await this.stepRepairEngine.repair({
        step: input.effectiveStep,
        reason: latestErrorMessage,
        snapshot: reasoningSnapshot,
        processCode: input.request.flow.processCode,
        processName: input.request.flow.processName,
        fields: input.request.flow.fields || [],
        formData: input.request.payload.formData || {},
        preferredRegionId: this.readRuntimeHint(input.effectiveStep, 'preferredRegionId'),
        preferredFormId: this.readRuntimeHint(input.effectiveStep, 'preferredFormId'),
        preferredFrameUrl: this.readRuntimeHint(input.effectiveStep, 'preferredFrameUrl'),
        anchorElementRef: this.readRuntimeHint(input.effectiveStep, 'anchorElementRef'),
      });

      if (
        !repairJudgement.canRepair
        || !repairJudgement.repairedStep
        || !this.hasMeaningfulRepair(input.effectiveStep, repairJudgement.repairedStep)
      ) {
        break;
      }

      const repairSignature = this.buildRepairSignature(repairJudgement.repairedStep);
      if (attemptedRepairs.has(repairSignature)) {
        break;
      }
      attemptedRepairs.add(repairSignature);

      const repairReason = `step_repair_round_${round + 1}:${repairJudgement.reasoning[0] || 'semantic_retarget'}`;
      try {
        const repaired = await input.actionExecutor.executeStep(
          input.session,
          input.tab,
          repairJudgement.repairedStep,
          input.index,
          reasoningSnapshot.snapshotId,
        );
        input.recoveryAttempts.push({
          stepIndex: input.index,
          reason: repairReason,
          recovered: true,
          snapshotId: reasoningSnapshot.snapshotId,
        });
        input.executedSteps.push({
          ...repaired.stepResult,
          status: 'recovered',
        });
        this.registerAdaptiveStepPlan(
          input.step,
          input.effectiveStep,
          repairJudgement.repairedStep,
          input.adaptiveStepPlans,
        );

        if (repaired.refreshSnapshot) {
          currentSnapshot = await this.captureSnapshot(input.engine, input.session, input.tab);
          input.snapshots.push(currentSnapshot);
        }

        return {
          recovered: true,
          currentSnapshot,
          activatedScope: this.deriveExecutionScope(repaired.stepResult, reasoningSnapshot),
          errorMessage: latestErrorMessage,
        };
      } catch (repairError: any) {
        latestErrorMessage = repairError.message || latestErrorMessage;
        input.recoveryAttempts.push({
          stepIndex: input.index,
          reason: repairReason,
          recovered: false,
          snapshotId: reasoningSnapshot.snapshotId,
        });

        const nextSnapshot = await this.captureRecoverySnapshot(
          input.engine,
          input.session,
          input.tab,
          reasoningSnapshot,
        );
        if (
          nextSnapshot
          && input.snapshots[input.snapshots.length - 1]?.snapshotId !== nextSnapshot.snapshotId
        ) {
          input.snapshots.push(nextSnapshot);
        }
        currentSnapshot = nextSnapshot || currentSnapshot;
        reasoningSnapshot = nextSnapshot || reasoningSnapshot;
      }
    }

    return {
      recovered: false,
      currentSnapshot,
      activatedScope: undefined,
      errorMessage: latestErrorMessage,
    };
  }

  private buildRepairSignature(step: RpaStepDefinition) {
    return [
      step.type,
      step.selector || '',
      step.fieldKey || '',
      step.target?.kind || '',
      step.target?.value || '',
    ].join('|');
  }

  private async planExecutableStep(
    step: RpaStepDefinition,
    adaptiveStepPlans: Map<string, RpaStepDefinition>,
    activeScope: AdaptiveExecutionScope | null,
    currentSnapshot: BrowserTaskRunResult['finalSnapshot'],
    request: BrowserTaskRequest,
  ) {
    const planned = this.applyAdaptiveStepPlan(step, adaptiveStepPlans);
    const scoped = this.injectAdaptiveScope(planned, activeScope);

    if (!currentSnapshot || !activeScope || !this.isScopeSensitiveStep(scoped)) {
      return scoped;
    }

    const scopedPlan = await this.stepRepairEngine.repair({
      step: scoped,
      reason: 'pre_execution_scope_alignment',
      snapshot: currentSnapshot,
      processCode: request.flow.processCode,
      processName: request.flow.processName,
      fields: request.flow.fields || [],
      formData: request.payload.formData || {},
      preferredRegionId: activeScope.regionId,
      preferredFormId: activeScope.formId,
      preferredFrameUrl: activeScope.frameUrl,
      anchorElementRef: activeScope.anchorElementRef,
    });

    if (
      scopedPlan.canRepair
      && scopedPlan.repairedStep
      && this.hasMeaningfulRepair(scoped, scopedPlan.repairedStep)
    ) {
      return scopedPlan.repairedStep;
    }

    return scoped;
  }

  private applyAdaptiveStepPlan(
    step: RpaStepDefinition,
    adaptiveStepPlans: Map<string, RpaStepDefinition>,
  ) {
    const planned = this.resolveAdaptiveStepPlan(step, adaptiveStepPlans);
    if (!planned) {
      return step;
    }

    return {
      ...step,
      selector: planned.selector || step.selector,
      fieldKey: step.fieldKey || planned.fieldKey,
      target: planned.target || step.target,
      options: {
        ...(step.options || {}),
        ...(planned.options || {}),
      },
      stabilityKey: step.stabilityKey || planned.stabilityKey,
    };
  }

  private injectAdaptiveScope(
    step: RpaStepDefinition,
    activeScope: AdaptiveExecutionScope | null,
  ) {
    if (!activeScope) {
      return step;
    }

    return {
      ...step,
      options: {
        ...(step.options || {}),
        __runtime: {
          ...((((step.options || {}) as Record<string, any>).__runtime || {}) as Record<string, any>),
          ...(activeScope.regionId ? { preferredRegionId: activeScope.regionId } : {}),
          ...(activeScope.formId ? { preferredFormId: activeScope.formId } : {}),
          ...(activeScope.frameUrl ? { preferredFrameUrl: activeScope.frameUrl } : {}),
          ...(activeScope.anchorElementRef ? { anchorElementRef: activeScope.anchorElementRef } : {}),
        },
      },
    };
  }

  private resolveAdaptiveStepPlan(
    step: RpaStepDefinition,
    adaptiveStepPlans: Map<string, RpaStepDefinition>,
  ) {
    for (const key of this.buildAdaptiveStepPlanKeys(step)) {
      const planned = adaptiveStepPlans.get(key);
      if (planned) {
        return planned;
      }
    }

    return null;
  }

  private registerAdaptiveStepPlan(
    originalStep: RpaStepDefinition,
    effectiveStep: RpaStepDefinition,
    repairedStep: RpaStepDefinition,
    adaptiveStepPlans: Map<string, RpaStepDefinition>,
  ) {
    const keys = new Set([
      ...this.buildAdaptiveStepPlanKeys(originalStep),
      ...this.buildAdaptiveStepPlanKeys(effectiveStep),
      ...this.buildAdaptiveStepPlanKeys(repairedStep),
    ]);

    for (const key of keys) {
      adaptiveStepPlans.set(key, repairedStep);
    }
  }

  private deriveExecutionScope(
    stepResult: BrowserTaskRunResult['executedSteps'][number],
    snapshot: BrowserTaskRunResult['finalSnapshot'],
  ): AdaptiveExecutionScope | null {
    if (!snapshot) {
      return null;
    }

    const element = this.resolveExecutedElement(snapshot, stepResult);
    if (!element) {
      return null;
    }

    const regionId = element.regionId
      || snapshot.regions.find((region) => (region.elementRefs || []).includes(element.ref))?.id;
    const formId = snapshot.forms.find((form) => (form.fieldRefs || []).includes(element.ref))?.id;
    const frameUrl = this.extractFrameScopeUrl(element);
    if (!regionId && !formId && !frameUrl && !element.ref) {
      return null;
    }

    return {
      regionId,
      formId,
      frameUrl,
      anchorElementRef: element.ref,
    };
  }

  private refineActiveScopeFromSnapshot(
    snapshot: BrowserTaskRunResult['finalSnapshot'],
    activeScope: AdaptiveExecutionScope | null,
  ) {
    const dialogScope = this.deriveDialogScopeFromSnapshot(snapshot);
    if (!dialogScope) {
      return activeScope;
    }

    return {
      ...(activeScope || {}),
      ...dialogScope,
    };
  }

  private deriveDialogScopeFromSnapshot(
    snapshot: BrowserTaskRunResult['finalSnapshot'],
  ): AdaptiveExecutionScope | null {
    if (!snapshot) {
      return null;
    }

    const dialogRegion = this.selectDialogRegion(snapshot);
    if (!dialogRegion) {
      return null;
    }

    const anchorElement = snapshot.interactiveElements.find((element) =>
      (dialogRegion.elementRefs || []).includes(element.ref),
    );
    const formId = snapshot.forms.find((form) =>
      (form.fieldRefs || []).some((ref) => (dialogRegion.elementRefs || []).includes(ref)),
    )?.id;

    return {
      regionId: dialogRegion.id,
      formId,
      frameUrl: anchorElement ? this.extractFrameScopeUrl(anchorElement) : undefined,
      anchorElementRef: anchorElement?.ref,
    };
  }

  private selectDialogRegion(
    snapshot: NonNullable<BrowserTaskRunResult['finalSnapshot']>,
  ) {
    const dialogRegions = snapshot.regions
      .filter((region) => region.role === 'dialog' && (region.elementRefs || []).length > 0);
    const dialogTitle = this.normalizeScopeText(snapshot.dialogs[0]?.title);

    if (dialogTitle) {
      const titledDialogRegion = [...dialogRegions, ...snapshot.regions].find((region) => {
        const normalizedName = this.normalizeScopeText(region.name);
        const normalizedSummary = this.normalizeScopeText(region.summary);
        return normalizedName === dialogTitle
          || normalizedSummary === dialogTitle;
      });
      if (titledDialogRegion && (titledDialogRegion.elementRefs || []).length > 0) {
        return titledDialogRegion;
      }
    }

    if (dialogRegions.length === 0) {
      return null;
    }

    return [...dialogRegions]
      .sort((left, right) => (right.elementRefs?.length || 0) - (left.elementRefs?.length || 0))[0] || null;
  }

  private resolveExecutedElement(
    snapshot: NonNullable<BrowserTaskRunResult['finalSnapshot']>,
    stepResult: BrowserTaskRunResult['executedSteps'][number],
  ) {
    if (stepResult.elementRef) {
      const matchedByRef = snapshot.interactiveElements.find((candidate) => candidate.ref === stepResult.elementRef);
      if (matchedByRef) {
        return matchedByRef;
      }
    }

    if (stepResult.selector) {
      const matchedBySelector = snapshot.interactiveElements.find((candidate) => candidate.selector === stepResult.selector);
      if (matchedBySelector) {
        return matchedBySelector;
      }
    }

    if (stepResult.fieldKey) {
      return snapshot.interactiveElements.find((candidate) => candidate.fieldKey === stepResult.fieldKey) || null;
    }

    return null;
  }

  private buildAdaptiveStepPlanKeys(step: RpaStepDefinition) {
    const keys = new Set<string>();
    const add = (prefix: string, value?: string | null) => {
      const normalized = this.normalizeAdaptiveStepKey(value);
      if (normalized) {
        keys.add(`${prefix}:${normalized}`);
      }
    };

    add('stability', step.stabilityKey);
    add('field', step.fieldKey);
    add('selector', step.selector);
    if (step.target) {
      add(`target_${step.target.kind}`, step.target.value);
      add(`target_label_${step.target.kind}`, step.target.label);
    }

    if (keys.size === 0) {
      add('description', step.description);
    }

    return [...keys];
  }

  private isScopeSensitiveStep(step: RpaStepDefinition) {
    return ['input', 'select', 'upload', 'extract', 'click'].includes(step.type);
  }

  private readRuntimeHint(step: RpaStepDefinition, key: string) {
    const runtime = (step.options as Record<string, any> | undefined)?.__runtime;
    return typeof runtime?.[key] === 'string' ? runtime[key] : undefined;
  }

  private extractFrameScopeUrl(
    element: NonNullable<BrowserTaskRunResult['finalSnapshot']>['interactiveElements'][number],
  ) {
    return (element.targetHints || []).find((hint) =>
      hint.kind === 'url' && hint.label === 'scope:frame',
    )?.value;
  }

  private normalizeAdaptiveStepKey(value?: string | null) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private normalizeScopeText(value?: string | null) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private hasMeaningfulRepair(
    originalStep: RpaStepDefinition,
    repairedStep: RpaStepDefinition,
  ) {
    const originalTarget = `${originalStep.target?.kind || ''}:${originalStep.target?.value || ''}`;
    const repairedTarget = `${repairedStep.target?.kind || ''}:${repairedStep.target?.value || ''}`;
    return originalStep.selector !== repairedStep.selector
      || originalStep.fieldKey !== repairedStep.fieldKey
      || originalTarget !== repairedTarget;
  }

  private canRetryFailedStep(
    step: RpaStepDefinition,
    snapshot: BrowserTaskRunResult['finalSnapshot'],
  ) {
    if (!snapshot) {
      return false;
    }

    const elements = snapshot.interactiveElements || [];
    if (step.selector && elements.some((element) => element.selector === step.selector)) {
      return true;
    }

    if (step.fieldKey && elements.some((element) => element.fieldKey === step.fieldKey)) {
      return true;
    }

    const textTarget = step.target?.kind === 'text'
      ? step.target.value
      : undefined;
    if (textTarget) {
      return elements.some((element) =>
        this.matchesSnapshotText(element.text, textTarget) || this.matchesSnapshotText(element.label, textTarget),
      );
    }

    return false;
  }

  private matchesSnapshotText(left?: string, right?: string) {
    const normalizedLeft = String(left || '').trim().toLowerCase();
    const normalizedRight = String(right || '').trim().toLowerCase();
    return normalizedLeft.length > 0
      && normalizedRight.length > 0
      && normalizedLeft === normalizedRight;
  }

  private collectRequestedFieldDescriptors(request: BrowserTaskRequest, formDataKeys: string[]) {
    const keyedFields = (request.flow.fields || []).filter((field) => formDataKeys.includes(field.key));
    const candidates = keyedFields.length > 0
      ? keyedFields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
        }))
      : formDataKeys.map((key) => ({ key }));

    return candidates.map((field) => this.describeField(field, request.flow.processCode));
  }

  private collectSnapshotFieldDescriptors(
    snapshot: BrowserTaskRunResult['finalSnapshot'],
    processCode?: string,
  ) {
    const formFields = (snapshot?.forms || []).flatMap((form) =>
      (form.fields || []).map((field) =>
        this.describeField(
          {
            key: field.fieldKey,
            label: field.label,
            type: 'input',
          },
          processCode,
        ),
      ),
    );
    const interactiveFields = (snapshot?.interactiveElements || []).map((element) =>
      this.describeField(
        {
          key: element.fieldKey,
          label: element.label,
          type: element.role,
        },
        processCode,
      ),
    );

    return [...formFields, ...interactiveFields];
  }

  private describeField(
    field: {
      key?: string | null;
      label?: string | null;
      type?: string | null;
    },
    processCode?: string,
  ) {
    const presentation = resolveAssistantFieldPresentation({
      key: field.key,
      label: field.label,
      type: field.type,
      processCode,
    });

    return {
      key: String(field.key || '').trim().toLowerCase(),
      aliases: presentation.aliases.map((alias) => String(alias || '').trim()).filter(Boolean),
    };
  }

  private matchesFieldDescriptor(
    requested: ReturnType<BrowserTaskRuntime['describeField']>,
    candidate: ReturnType<BrowserTaskRuntime['describeField']>,
  ) {
    if (requested.key && candidate.key && requested.key === candidate.key) {
      return true;
    }

    return requested.aliases.some((left) =>
      candidate.aliases.some((right) => this.matchesSnapshotText(left, right)),
    );
  }

  private collectSnapshotTexts(snapshot: BrowserTaskRunResult['finalSnapshot']) {
    return [
      snapshot?.title,
      snapshot?.structuredText,
      ...(snapshot?.importantTexts || []),
      ...((snapshot?.forms || []).flatMap((form) => [
        form.name,
        ...(form.fields || []).flatMap((field) => [field.label, field.fieldKey]),
      ])),
      ...((snapshot?.interactiveElements || []).flatMap((element) => [
        element.text,
        element.label,
        element.fieldKey,
      ])),
    ].filter(Boolean) as string[];
  }

  private async captureRecoverySnapshot(
    engine: ReturnType<BrowserEngineFactory['create']>['adapter'],
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    fallbackSnapshot: BrowserTaskRunResult['finalSnapshot'],
  ) {
    try {
      return await this.captureSnapshot(engine, session, tab);
    } catch {
      return fallbackSnapshot;
    }
  }
}
