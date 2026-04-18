export const ACTIVE_SUBMISSION_STATUSES = ['pending', 'submitted'] as const;

const UNSUPPORTED_STATUS_QUERY_ERROR_PATTERNS = [
  'no rpa status query flow configured',
  'status query is not configured',
  'query status is not configured',
  'no adapter available for status query',
] as const;

export function isActiveSubmissionStatus(status: string) {
  return ACTIVE_SUBMISSION_STATUSES.includes(status as (typeof ACTIVE_SUBMISSION_STATUSES)[number]);
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
}

function stringifySafely(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function inferSubmissionCompletionKind(
  submitResult: unknown,
): 'draft' | 'submitted' | null {
  const result = asRecord(submitResult);
  if (!result) {
    return null;
  }

  const metadata = asRecord(result.metadata);
  const request = asRecord(metadata?.request);
  const response = asRecord(metadata?.response);
  const explicitKind = String(
    request?.completionKind
      || metadata?.completionKind
      || result.completionKind
      || '',
  )
    .trim()
    .toLowerCase();

  if (explicitKind === 'draft') {
    return 'draft';
  }
  if (explicitKind === 'submitted') {
    return 'submitted';
  }

  const draftSignals = [
    stringifySafely(response?.data),
    stringifySafely(request?.url),
    stringifySafely(request?.body),
  ]
    .join('\n')
    .toLowerCase();

  if (
    /endsavedraft\s*\(/i.test(draftSignals)
    || /method=savedraft/i.test(draftSignals)
    || /saveasdraft/i.test(draftSignals)
  ) {
    return 'draft';
  }

  return null;
}

export function normalizeSubmissionStatus(
  status: string | null | undefined,
  options?: {
    submitResult?: unknown;
    latestEventType?: string | null;
  },
) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'draft' || normalized === 'draft_saved') {
    return 'draft_saved';
  }

  if (normalized !== 'pending') {
    return normalized;
  }

  const latestEventType = String(options?.latestEventType || '').trim().toLowerCase();
  if (latestEventType === 'draft_saved') {
    return 'draft_saved';
  }

  return inferSubmissionCompletionKind(options?.submitResult) === 'draft'
    ? 'draft_saved'
    : normalized;
}

export function isUnsupportedStatusQueryResult(
  result:
    | {
        status?: string | null;
        statusDetail?: Record<string, any> | null;
        errorMessage?: string | null;
      }
    | null
    | undefined,
) {
  if (!result || typeof result !== 'object') {
    return false;
  }

  const normalizedStatus = typeof result.status === 'string'
    ? result.status.trim().toLowerCase()
    : '';

  if (normalizedStatus !== 'error') {
    return false;
  }

  const errorMessages = [
    result.errorMessage,
    result.statusDetail?.error,
    result.statusDetail?.message,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());

  return errorMessages.some((message) =>
    UNSUPPORTED_STATUS_QUERY_ERROR_PATTERNS.some((pattern) => message.includes(pattern)),
  );
}

export function mapExternalStatusToSubmissionStatus(
  externalStatus: string | null | undefined,
  fallbackStatus: string,
) {
  const normalized = (externalStatus || '').trim().toLowerCase();

  if (!normalized) return fallbackStatus;

  if (
    ['error', 'failed', 'failure', 'timeout'].includes(normalized)
    || normalized.includes('失败')
    || normalized.includes('异常')
  ) {
    return 'failed';
  }

  if (
    ['cancelled', 'canceled', 'revoked', 'terminated'].includes(normalized)
    || normalized.includes('recall')
    || normalized.includes('取消')
    || normalized.includes('撤回')
    || normalized.includes('撤销')
  ) {
    return 'cancelled';
  }

  if (
    normalized.includes('reject')
    || normalized.includes('deny')
    || normalized.includes('refuse')
    || normalized.includes('驳回')
    || normalized.includes('拒绝')
  ) {
    return 'rejected';
  }

  if (
    normalized.includes('draft')
    || normalized.includes('create')
    || normalized.includes('new')
    || normalized.includes('init')
    || normalized.includes('saved')
    || normalized.includes('草稿')
    || normalized.includes('新建')
    || normalized.includes('已创建')
  ) {
    return 'pending';
  }

  if (
    normalized.includes('approve')
    || normalized.includes('pass')
    || normalized.includes('finish')
    || normalized.includes('complete')
    || normalized.includes('done')
    || normalized.includes('success')
    || normalized.includes('通过')
    || normalized.includes('办结')
    || normalized.includes('完成')
  ) {
    return 'approved';
  }

  if (
    normalized.includes('pending')
    || normalized.includes('review')
    || normalized.includes('process')
    || normalized.includes('progress')
    || normalized.includes('approval')
    || normalized.includes('queue')
    || normalized.includes('wait')
    || normalized.includes('submit')
    || normalized.includes('待审')
    || normalized.includes('审批中')
    || normalized.includes('处理中')
    || normalized.includes('待处理')
  ) {
    return 'submitted';
  }

  return fallbackStatus;
}

export function getSubmissionStatusText(status: string) {
  const map: Record<string, string> = {
    draft: '已保存待发',
    draft_saved: '已保存待发',
    pending: '待处理',
    submitted: '审批中',
    approved: '已通过',
    rejected: '已驳回',
    failed: '失败',
    cancelled: '已撤回',
  };

  return map[status] || status;
}
