export const ACTIVE_SUBMISSION_STATUSES = ['pending', 'submitted'] as const;

export function isActiveSubmissionStatus(status: string) {
  return ACTIVE_SUBMISSION_STATUSES.includes(status as (typeof ACTIVE_SUBMISSION_STATUSES)[number]);
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
    pending: '待处理',
    submitted: '审批中',
    approved: '已通过',
    rejected: '已驳回',
    failed: '失败',
    cancelled: '已撤回',
  };

  return map[status] || status;
}
