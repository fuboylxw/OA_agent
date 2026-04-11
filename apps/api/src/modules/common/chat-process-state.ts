export enum ChatProcessStatus {
  INITIALIZED = 'initialized',
  AUTH_REQUIRED = 'auth_required',
  PARAMETER_COLLECTION = 'parameter_collection',
  PENDING_CONFIRMATION = 'pending_confirmation',
  EXECUTING = 'executing',
  SUBMITTED = 'submitted',
  REWORK_REQUIRED = 'rework_required',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export type ReworkHint = 'supplement' | 'modify' | 'unknown';

export function requiresUserAction(status?: ChatProcessStatus | null) {
  return [
    ChatProcessStatus.AUTH_REQUIRED,
    ChatProcessStatus.PARAMETER_COLLECTION,
    ChatProcessStatus.PENDING_CONFIRMATION,
    ChatProcessStatus.REWORK_REQUIRED,
  ].includes((status || null) as ChatProcessStatus);
}

export function isTerminalChatProcessStatus(status?: ChatProcessStatus | null) {
  return [
    ChatProcessStatus.COMPLETED,
    ChatProcessStatus.FAILED,
    ChatProcessStatus.CANCELLED,
  ].includes((status || null) as ChatProcessStatus);
}

export function mapSubmissionStatusToChatProcessStatus(submissionStatus?: string | null) {
  switch ((submissionStatus || '').toLowerCase()) {
    case 'pending':
      return ChatProcessStatus.EXECUTING;
    case 'submitted':
    case 'in_progress':
      return ChatProcessStatus.SUBMITTED;
    case 'approved':
    case 'completed':
      return ChatProcessStatus.COMPLETED;
    case 'rejected':
      return ChatProcessStatus.REWORK_REQUIRED;
    case 'cancelled':
      return ChatProcessStatus.CANCELLED;
    case 'failed':
      return ChatProcessStatus.FAILED;
    default:
      return ChatProcessStatus.SUBMITTED;
  }
}
