export const BOOTSTRAP_QUEUE_PENDING_STATUSES = [
  'CREATED',
  'AUTO_RECOVERING',
  'AUTO_RECONCILING',
] as const;

export const BOOTSTRAP_PROCESSING_STATUSES = [
  'DISCOVERING',
  'PARSING',
  'AUTH_PROBING',
  'VALIDATING',
  'SELF_HEALING',
  'REVALIDATING',
  'NORMALIZING',
  'COMPILING',
] as const;

export const BOOTSTRAP_TERMINAL_STATUSES = [
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'VALIDATION_FAILED',
  'FAILED',
  'MANUAL_REVIEW',
  'CONNECTOR_DELETED',
] as const;

export const BOOTSTRAP_ACTIVE_STATUSES = [
  ...BOOTSTRAP_QUEUE_PENDING_STATUSES,
  ...BOOTSTRAP_PROCESSING_STATUSES,
] as const;

export type BootstrapQueuePendingStatus =
  typeof BOOTSTRAP_QUEUE_PENDING_STATUSES[number];
export type BootstrapProcessingStatus =
  typeof BOOTSTRAP_PROCESSING_STATUSES[number];
export type BootstrapTerminalStatus =
  typeof BOOTSTRAP_TERMINAL_STATUSES[number];
export type BootstrapActiveStatus = typeof BOOTSTRAP_ACTIVE_STATUSES[number];
export type BootstrapRuntimeStatus =
  | BootstrapQueuePendingStatus
  | BootstrapProcessingStatus
  | BootstrapTerminalStatus;

export const BOOTSTRAP_JOB_HEARTBEAT_INTERVAL_MS = 10_000;
export const BOOTSTRAP_JOB_STALL_THRESHOLD_MS = 30_000;
export const BOOTSTRAP_JOB_WATCHDOG_INTERVAL_MS = 10_000;
export const BOOTSTRAP_JOB_AUTO_RECOVERY_LIMIT = 2;
export const BOOTSTRAP_JOB_AUTO_RECONCILE_LIMIT = 1;
