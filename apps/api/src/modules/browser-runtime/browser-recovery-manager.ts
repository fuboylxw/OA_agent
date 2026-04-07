import type { BrowserPageSnapshot, RpaStepDefinition } from '@uniflow/shared-types';
import type { RpaRecoveryAttempt } from '../adapter-runtime/rpa-executor';
import { ElementRefCache } from './element-ref-cache';
import { PageSnapshotGenerator } from './page-snapshot-generator';
import type { BrowserSessionRecord, BrowserTabRecord } from './browser-runtime.types';

export class BrowserRecoveryManager {
  constructor(
    private readonly snapshotGenerator: PageSnapshotGenerator,
    private readonly refCache: ElementRefCache,
  ) {}

  attemptRecovery(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    stepIndex: number,
    step: RpaStepDefinition,
    reason: string,
  ): {
    attempt: RpaRecoveryAttempt;
    snapshot: BrowserPageSnapshot;
    recoveredElement?: ReturnType<ElementRefCache['resolveElement']>;
  } {
    const snapshot = this.snapshotGenerator.generate(session, tab);
    const recoveredElement = this.refCache.resolveElement(session.sessionId, tab.tabId, step);
    return {
      attempt: {
        stepIndex,
        reason,
        recovered: !!recoveredElement,
        snapshotId: snapshot.snapshotId,
      },
      snapshot,
      recoveredElement,
    };
  }
}
