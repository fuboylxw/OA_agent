import { createHash } from 'crypto';

export interface FlowDiscoverySnapshot {
  flowCode: string;
  flowName: string;
  entryUrl?: string | null;
  submitUrl?: string | null;
  queryUrl?: string | null;
}

export interface FlowChangeSummary {
  changeType: 'created' | 'updated' | 'unchanged';
  changedFields: Array<{
    field: 'flowName' | 'entryUrl' | 'submitUrl' | 'queryUrl';
    previousValue: string | null;
    currentValue: string | null;
  }>;
  previousFlow: FlowDiscoverySnapshot | null;
  currentFlow: FlowDiscoverySnapshot;
}

export function createDeterministicHash(input: unknown) {
  return createHash('sha256')
    .update(stableStringify(input))
    .digest('hex');
}

export function buildStatusEventRemoteId(externalSubmissionId: string, payload: Record<string, any>) {
  return `${externalSubmissionId}:${createDeterministicHash(payload).slice(0, 24)}`;
}

export function buildFlowChangeSummary(
  previousFlow: FlowDiscoverySnapshot | null | undefined,
  currentFlow: FlowDiscoverySnapshot,
): FlowChangeSummary {
  const normalizedPrevious = previousFlow ? normalizeFlowSnapshot(previousFlow) : null;
  const normalizedCurrent = normalizeFlowSnapshot(currentFlow);
  const trackedFields: Array<'flowName' | 'entryUrl' | 'submitUrl' | 'queryUrl'> = [
    'flowName',
    'entryUrl',
    'submitUrl',
    'queryUrl',
  ];

  const changedFields = trackedFields.flatMap((field) => {
    const previousValue = normalizedPrevious?.[field] ?? null;
    const currentValue = normalizedCurrent[field] ?? null;

    if (previousValue === currentValue) {
      return [];
    }

    return [{
      field,
      previousValue,
      currentValue,
    }];
  });

  return {
    changeType: !normalizedPrevious
      ? 'created'
      : changedFields.length > 0
        ? 'updated'
        : 'unchanged',
    changedFields,
    previousFlow: normalizedPrevious,
    currentFlow: normalizedCurrent,
  };
}

export function mergeDiscoveredFlowUiHints(
  existingUiHints: Record<string, any> | null | undefined,
  flow: FlowDiscoverySnapshot,
) {
  const normalizedFlow = normalizeFlowSnapshot(flow);

  return {
    ...(existingUiHints || {}),
    discovery: {
      ...((existingUiHints as Record<string, any> | undefined)?.discovery || {}),
      flow: normalizedFlow,
      syncedAt: new Date().toISOString(),
    },
  };
}

function normalizeFlowSnapshot(flow: FlowDiscoverySnapshot): FlowDiscoverySnapshot {
  return {
    flowCode: String(flow.flowCode),
    flowName: String(flow.flowName),
    entryUrl: flow.entryUrl ?? null,
    submitUrl: flow.submitUrl ?? null,
    queryUrl: flow.queryUrl ?? null,
  };
}

function stableStringify(input: unknown) {
  return JSON.stringify(normalizeForHash(input));
}

function normalizeForHash(input: unknown): unknown {
  if (input === null || input === undefined) {
    return null;
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  if (Array.isArray(input)) {
    return input.map((item) => normalizeForHash(item));
  }

  if (typeof input === 'object') {
    return Object.keys(input as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeForHash((input as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return input;
}
