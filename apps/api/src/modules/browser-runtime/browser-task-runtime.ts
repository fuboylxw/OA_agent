import type { RpaActionDefinition, RpaFlowDefinition } from '@uniflow/shared-types';
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
          currentSnapshot = recovery.snapshot;
          snapshots.push(currentSnapshot);

          if (recovery.attempt.recovered) {
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
}
