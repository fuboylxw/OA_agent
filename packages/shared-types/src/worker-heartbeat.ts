export const BOOTSTRAP_WORKER_HEARTBEAT_KEY = 'uniflow:workers:bootstrap:heartbeat';
export const BOOTSTRAP_WORKER_HEARTBEAT_INTERVAL_MS = 5000;
export const BOOTSTRAP_WORKER_HEARTBEAT_TTL_SECONDS = 15;
export const BOOTSTRAP_WORKER_STALE_AFTER_MS =
  BOOTSTRAP_WORKER_HEARTBEAT_TTL_SECONDS * 1000;

export interface BootstrapWorkerHeartbeatPayload {
  service: 'uniflow-worker';
  queue: 'bootstrap';
  instanceId: string;
  pid: number;
  hostname: string;
  startedAt: string;
  updatedAt: string;
}
