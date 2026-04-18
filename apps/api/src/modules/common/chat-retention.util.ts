import { ChatProcessStatus, isTerminalChatProcessStatus } from './chat-process-state';

const DAY_MS = 24 * 60 * 60 * 1000;

function readPositiveInt(name: string, fallback: number) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getChatConversationRestoreRetentionDays() {
  return readPositiveInt('CHAT_CONVERSATION_RESTORE_RETENTION_DAYS', 30);
}

export function getChatConversationSummaryRetentionDays() {
  return readPositiveInt('CHAT_CONVERSATION_SUMMARY_RETENTION_DAYS', 180);
}

export function getRestoreStatusForProcess(processStatus?: string | null) {
  const normalized = String(processStatus || '').trim().toLowerCase() as ChatProcessStatus | '';
  if (!normalized) {
    return 'unavailable';
  }

  if (!isTerminalChatProcessStatus(normalized)) {
    return 'available';
  }

  return normalized === ChatProcessStatus.COMPLETED
    || normalized === ChatProcessStatus.CANCELLED
    || normalized === ChatProcessStatus.FAILED
    || normalized === ChatProcessStatus.DRAFT_SAVED
    ? 'available'
    : 'unavailable';
}

export function shouldApplyChatRetention(processStatus?: string | null) {
  const normalized = String(processStatus || '').trim().toLowerCase() as ChatProcessStatus | '';
  return normalized === ChatProcessStatus.COMPLETED
    || normalized === ChatProcessStatus.CANCELLED
    || normalized === ChatProcessStatus.FAILED;
}

export function buildConversationRestoreState(processStatus?: string | null, baseDate = new Date()) {
  const restoreStatus = getRestoreStatusForProcess(processStatus);
  if (!shouldApplyChatRetention(processStatus)) {
    return {
      restoreStatus,
      restoreExpiresAt: null,
      retainedUntil: null,
      statusCategory: 'active' as const,
    };
  }

  const retentionWindow = buildChatRetentionWindow(baseDate);
  return {
    restoreStatus,
    restoreExpiresAt: retentionWindow.restoreExpiresAt,
    retainedUntil: retentionWindow.retainedUntil,
    statusCategory: 'terminal' as const,
  };
}

export function buildChatRetentionWindow(baseDate = new Date()) {
  const restoreExpiresAt = new Date(baseDate.getTime() + getChatConversationRestoreRetentionDays() * DAY_MS);
  const retainedUntil = new Date(baseDate.getTime() + getChatConversationSummaryRetentionDays() * DAY_MS);

  return {
    restoreExpiresAt,
    retainedUntil,
  };
}

export function isConversationRestorable(options: {
  status?: string | null;
  restoreStatus?: string | null;
  restoreExpiresAt?: string | Date | null;
  retainedUntil?: string | Date | null;
}) {
  const restoreStatus = String(options.restoreStatus || '').trim().toLowerCase();
  if (restoreStatus === 'summary_only' || restoreStatus === 'unavailable') {
    return false;
  }

  if (options.restoreExpiresAt) {
    const restoreUntil = new Date(options.restoreExpiresAt);
    if (Number.isFinite(restoreUntil.getTime()) && restoreUntil.getTime() < Date.now()) {
      return false;
    }
  }

  const status = String(options.status || '').trim().toLowerCase();
  if (!status) {
    return false;
  }

  return restoreStatus === 'available' || isTerminalChatProcessStatus(status as ChatProcessStatus) || status === 'submitted';
}
