import {
  resolveAssistantFieldPresentation,
  type RpaActionDefinition,
  type RpaFlowDefinition,
  type RpaStepDefinition,
} from '@uniflow/shared-types';
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

export class BrowserTaskRuntime {
  private readonly sessionManager = new BrowserSessionManager();
  private readonly securityPolicy = new BrowserSecurityPolicy();
  private readonly refCache = new ElementRefCache();
  private readonly snapshotGenerator = new PageSnapshotGenerator(this.refCache, this.securityPolicy);
  private readonly recoveryManager = new BrowserRecoveryManager(this.snapshotGenerator, this.refCache);
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
    let currentSnapshot = undefined as BrowserTaskRunResult['finalSnapshot'];
    let success = true;
    let errorMessage: string | undefined;

    try {
      await engineSelection.adapter.initialize(session, tab);
      currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
      snapshots.push(currentSnapshot);

      const actionDefinition = this.getActionDefinition(request.flow, request.action);
      const steps = (actionDefinition?.steps || []).slice(0, request.runtime.maxSteps || 50);

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];

        try {
          const execution = await actionExecutor.executeStep(
            session,
            tab,
            step,
            index,
            currentSnapshot.snapshotId,
          );
          executedSteps.push(execution.stepResult);

          if (execution.extractedValue) {
            tab.extractedValues[execution.extractedValue.key] = execution.extractedValue.value;
          }

          if (execution.refreshSnapshot) {
            currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
            snapshots.push(currentSnapshot);
          }
        } catch (error: any) {
          const recovery = this.recoveryManager.attemptRecovery(
            session,
            tab,
            index,
            step,
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

          if (this.canSkipFailedTextNavigationStep(step, currentSnapshot, request)) {
            executedSteps.push({
              index,
              type: step.type,
              selector: step.selector,
              fieldKey: step.fieldKey,
              status: 'recovered',
              value: step.value,
              description: step.description,
              targetKind: step.target?.kind || (step.selector ? 'selector' : undefined),
              snapshotId: currentSnapshot.snapshotId,
            });
            continue;
          }

          if (recovery.attempt.recovered && this.canRetryFailedStep(step, currentSnapshot)) {
            try {
              const retried = await actionExecutor.executeStep(
                session,
                tab,
                step,
                index,
                currentSnapshot.snapshotId,
              );
              executedSteps.push({
                ...retried.stepResult,
                status: 'recovered',
              });

              if (retried.refreshSnapshot) {
                currentSnapshot = await this.captureSnapshot(engineSelection.adapter, session, tab);
                snapshots.push(currentSnapshot);
              }
              continue;
            } catch (retryError: any) {
              errorMessage = retryError.message || error.message;
            }
          } else {
            errorMessage = error.message;
          }

          executedSteps.push({
            index,
            type: step.type,
            selector: step.selector,
            fieldKey: step.fieldKey,
            status: 'failed',
            value: step.value,
            description: step.description,
            targetKind: step.target?.kind || (step.selector ? 'selector' : undefined),
            snapshotId: currentSnapshot.snapshotId,
            errorMessage,
          });

          if (!step.continueOnError) {
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
      && (
        normalizedLeft.includes(normalizedRight)
        || normalizedRight.includes(normalizedLeft)
      );
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
      semanticKind: presentation.semanticKind,
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

    if (
      requested.semanticKind !== 'generic'
      && requested.semanticKind === candidate.semanticKind
    ) {
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
