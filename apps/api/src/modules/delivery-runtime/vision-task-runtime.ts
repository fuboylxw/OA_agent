import { Injectable } from '@nestjs/common';
import type {
  ArtifactReference,
  BrowserPageSnapshot,
  BrowserSnapshotElement,
  RpaActionDefinition,
  RpaRuntimeDefinition,
  RpaStepDefinition,
} from '@uniflow/shared-types';
import type { RpaExecutedStep, RpaExecutionAction } from '../adapter-runtime/rpa-executor';
import { BrowserEngineFactory, type BrowserEngineAdapter } from '../browser-runtime/browser-engine-adapter';
import { BrowserSecurityPolicy } from '../browser-runtime/browser-security-policy';
import { BrowserSessionManager } from '../browser-runtime/browser-session-manager';
import type {
  BrowserSessionRecord,
  BrowserTabRecord,
  BrowserTaskRequest,
  BrowserTaskWarning,
} from '../browser-runtime/browser-runtime.types';
import { ElementRefCache } from '../browser-runtime/element-ref-cache';
import { PageSnapshotGenerator } from '../browser-runtime/page-snapshot-generator';
import { VisionTargetResolver } from './vision-target-resolver';
import {
  detectAuthCredentialFieldKind,
  resolveAuthCredentialValue,
} from '../common/auth-field.util';

export interface VisionTaskRunResult {
  success: boolean;
  errorMessage?: string;
  sessionId: string;
  provider: string;
  requestedProvider: string;
  snapshots: BrowserPageSnapshot[];
  finalSnapshot?: BrowserPageSnapshot;
  executedSteps: RpaExecutedStep[];
  warnings: BrowserTaskWarning[];
  extractedValues: Record<string, any>;
  artifactRefs: ArtifactReference[];
}

@Injectable()
export class VisionTaskRuntime {
  private readonly sessionManager = new BrowserSessionManager();
  private readonly securityPolicy = new BrowserSecurityPolicy();
  private readonly refCache = new ElementRefCache();
  private readonly snapshotGenerator = new PageSnapshotGenerator(this.refCache, this.securityPolicy);
  private readonly engineFactory = new BrowserEngineFactory();

  constructor(private readonly targetResolver: VisionTargetResolver) {}

  async run(request: BrowserTaskRequest): Promise<VisionTaskRunResult> {
    const runtime = this.normalizeRuntime(request.runtime);
    const requestedProvider = runtime.browserProvider || 'playwright';
    const engineSelection = this.engineFactory.create(requestedProvider);
    const session = this.sessionManager.createSession(
      {
        ...request,
        runtime,
      },
      engineSelection.adapter.provider,
      requestedProvider,
      engineSelection.warnings,
    );
    const tab = this.sessionManager.getActiveTab(session);
    const executedSteps: RpaExecutedStep[] = [];
    const snapshots: BrowserPageSnapshot[] = [];
    const artifactRefs: ArtifactReference[] = [];
    const seenArtifactIds = new Set<string>();
    let currentSnapshot: BrowserPageSnapshot | undefined;
    let success = true;
    let errorMessage: string | undefined;

    try {
      await engineSelection.adapter.initialize(session, tab);
      currentSnapshot = await this.observe(engineSelection.adapter, session, tab, artifactRefs, seenArtifactIds, 'initial');
      snapshots.push(currentSnapshot);

      const actionDefinition = this.getActionDefinition(request, request.action);
      const steps = (actionDefinition?.steps || []).slice(0, runtime.maxSteps || 50);

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const beforeSnapshotId = currentSnapshot?.snapshotId;
        const resolvedTarget = this.requiresElement(step.type)
          ? this.targetResolver.resolve(step, currentSnapshot)
          : undefined;
        const element = resolvedTarget?.element;
        const value = this.resolveValue(step, tab.payload);

        try {
          this.securityPolicy.assertStepAllowed(step);
          if (this.requiresElement(step.type) && !element) {
            throw new Error(`Unable to resolve target for step ${step.type}: ${resolvedTarget?.reason || 'unknown_target'}`);
          }

          const extracted = await this.executeStep(
            engineSelection.adapter,
            session,
            tab,
            step,
            element,
            value,
            runtime.stabilityTimeoutMs,
          );

          if (extracted) {
            tab.extractedValues[extracted.key] = extracted.value;
          }

          currentSnapshot = await this.observe(
            engineSelection.adapter,
            session,
            tab,
            artifactRefs,
            seenArtifactIds,
            `step-${index + 1}-${step.type}`,
          );
          snapshots.push(currentSnapshot);

          executedSteps.push({
            index,
            type: step.type,
            selector: step.selector,
            fieldKey: step.fieldKey,
            status: 'executed',
            value,
            description: step.description,
            elementRef: element?.ref,
            targetKind: step.target?.kind || (step.selector ? 'selector' : undefined),
            snapshotId: beforeSnapshotId,
          });
        } catch (error: any) {
          errorMessage = error?.message || `Vision step ${step.type} failed`;
          const failedSnapshot = await this.observe(
            engineSelection.adapter,
            session,
            tab,
            artifactRefs,
            seenArtifactIds,
            `step-${index + 1}-${step.type}-error`,
          );
          currentSnapshot = failedSnapshot;
          snapshots.push(failedSnapshot);

          executedSteps.push({
            index,
            type: step.type,
            selector: step.selector,
            fieldKey: step.fieldKey,
            status: 'failed',
            value,
            description: step.description,
            elementRef: element?.ref,
            targetKind: step.target?.kind || (step.selector ? 'selector' : undefined),
            snapshotId: failedSnapshot.snapshotId || beforeSnapshotId,
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
      warnings: [...session.warnings],
      extractedValues: { ...tab.extractedValues },
      artifactRefs,
    };
  }

  private async executeStep(
    engine: BrowserEngineAdapter,
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    step: RpaStepDefinition,
    element: BrowserSnapshotElement | undefined,
    value: any,
    stabilityTimeoutMs?: number,
  ) {
    switch (step.type) {
      case 'goto':
        await engine.navigate(session, tab, this.resolveUrl(step, tab));
        break;
      case 'wait':
        await engine.stabilize(session, tab, step.timeoutMs || stabilityTimeoutMs);
        return undefined;
      case 'input':
        await engine.input(session, tab, element, value);
        break;
      case 'select':
        await engine.select(session, tab, element, value);
        break;
      case 'click':
        await engine.click(session, tab, element, step.target);
        break;
      case 'upload':
        await engine.upload(session, tab, element, value);
        break;
      case 'extract': {
        const extracted = await engine.extract(session, tab, element);
        return {
          key: step.fieldKey || 'lastExtracted',
          value: extracted,
        };
      }
      case 'download': {
        const downloaded = await engine.download(session, tab, element);
        tab.artifacts.lastDownload = downloaded;
        break;
      }
      case 'screenshot':
        break;
      default:
        throw new Error(`Unsupported vision step type: ${step.type}`);
    }

    await engine.stabilize(session, tab, step.timeoutMs || stabilityTimeoutMs);
    return undefined;
  }

  private async observe(
    engine: BrowserEngineAdapter,
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    artifactRefs: ArtifactReference[],
    seenArtifactIds: Set<string>,
    label: string,
  ) {
    let pageCapture = undefined as Awaited<ReturnType<BrowserEngineAdapter['capturePage']>>;
    try {
      pageCapture = await engine.capturePage(session, tab);
      tab.artifacts.lastPageCapture = pageCapture;
    } catch (error: any) {
      this.sessionManager.appendWarning(session, {
        code: 'vision_capture_failed',
        message: error?.message || `Failed to capture page for ${label}`,
      });
    }

    const snapshot = this.snapshotGenerator.generate(session, tab, pageCapture);
    this.pushArtifactRef(
      artifactRefs,
      seenArtifactIds,
      {
        id: snapshot.snapshotId,
        kind: 'page_snapshot',
        summary: `${label}: ${snapshot.title || 'Snapshot'} @ ${snapshot.url || 'unknown'}`,
      },
    );

    try {
      const screenshot = await engine.screenshot(session, tab);
      if (screenshot !== undefined && screenshot !== null) {
        this.pushArtifactRef(
          artifactRefs,
          seenArtifactIds,
          {
            id: `${snapshot.snapshotId}:screenshot`,
            kind: 'screenshot',
            uri: String(screenshot),
            summary: `${label}: screenshot`,
          },
        );
      }
    } catch (error: any) {
      this.sessionManager.appendWarning(session, {
        code: 'vision_screenshot_failed',
        message: error?.message || `Failed to capture screenshot for ${label}`,
      });
    }

    return snapshot;
  }

  private pushArtifactRef(
    artifactRefs: ArtifactReference[],
    seenArtifactIds: Set<string>,
    artifactRef: ArtifactReference,
  ) {
    if (seenArtifactIds.has(artifactRef.id)) {
      return;
    }
    seenArtifactIds.add(artifactRef.id);
    artifactRefs.push(artifactRef);
  }

  private getActionDefinition(
    request: BrowserTaskRequest,
    action: RpaExecutionAction,
  ): RpaActionDefinition | undefined {
    return action === 'submit'
      ? request.flow.actions?.submit
      : request.flow.actions?.queryStatus;
  }

  private normalizeRuntime(runtime: RpaRuntimeDefinition | undefined): RpaRuntimeDefinition {
    return {
      ...(runtime || {}),
      executorMode: 'browser',
      browserProvider: runtime?.browserProvider || 'playwright',
    };
  }

  private resolveValue(step: RpaStepDefinition, payload: Record<string, any>) {
    if (!step.fieldKey) {
      return step.value;
    }

    const authKind = detectAuthCredentialFieldKind({
      key: step.fieldKey,
      label: step.target?.label,
      description: step.description,
    });
    const authValue = authKind
      ? resolveAuthCredentialValue(authKind, payload.auth)
      : undefined;

    const attachment = Array.isArray(payload.attachments)
      ? payload.attachments.find((candidate: any) =>
          candidate?.fieldKey === step.fieldKey
          || candidate?.filename === step.value
          || candidate?.name === step.value,
        )
      : undefined;

    if (attachment) {
      if (Buffer.isBuffer(attachment.content)) {
        return {
          filename: attachment.filename || attachment.name || `${step.fieldKey}.bin`,
          mimeType: attachment.mimeType || 'application/octet-stream',
          buffer: attachment.content,
        };
      }

      if (Buffer.isBuffer(attachment.buffer)) {
        return attachment;
      }
    }

    return payload.formData?.[step.fieldKey]
      ?? authValue
      ?? payload[step.fieldKey]
      ?? step.value;
  }

  private resolveUrl(step: RpaStepDefinition, tab: BrowserTabRecord) {
    const candidate = step.target?.kind === 'url'
      ? step.target.value
      : step.value || step.selector || tab.ticket.jumpUrl || tab.flow.platform?.entryUrl || tab.url;
    return this.securityPolicy.sanitizeUrl(candidate);
  }

  private requiresElement(type: RpaStepDefinition['type']) {
    return type !== 'goto' && type !== 'wait' && type !== 'screenshot';
  }

  private cloneSnapshot(snapshot: BrowserPageSnapshot | undefined) {
    if (!snapshot) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(snapshot)) as BrowserPageSnapshot;
  }
}
