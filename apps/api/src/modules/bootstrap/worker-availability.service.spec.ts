import { WorkerAvailabilityService } from './worker-availability.service';

describe('WorkerAvailabilityService', () => {
  const originalTimeout = process.env.BOOTSTRAP_QUEUE_HEALTH_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.BOOTSTRAP_QUEUE_HEALTH_TIMEOUT_MS;
      return;
    }

    process.env.BOOTSTRAP_QUEUE_HEALTH_TIMEOUT_MS = originalTimeout;
  });

  it('returns queue_unreachable when queue readiness hangs', async () => {
    process.env.BOOTSTRAP_QUEUE_HEALTH_TIMEOUT_MS = '20';

    const service = new WorkerAvailabilityService({
      isReady: jest.fn(() => new Promise(() => undefined)),
      client: { get: jest.fn() },
      getJobCounts: jest.fn(),
    } as any);

    await expect(service.getBootstrapWorkerStatus()).resolves.toMatchObject({
      available: false,
      stale: true,
      heartbeat: null,
      queue: null,
      reason: 'queue_unreachable',
    });
  });

  it('returns available when heartbeat is fresh', async () => {
    const updatedAt = new Date().toISOString();
    const queueCounts = { waiting: 0, active: 0, completed: 0, failed: 0 };

    const service = new WorkerAvailabilityService({
      isReady: jest.fn().mockResolvedValue(undefined),
      client: {
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            updatedAt,
            pid: 1234,
            hostname: 'local-dev',
          }),
        ),
      },
      getJobCounts: jest.fn().mockResolvedValue(queueCounts),
    } as any);

    await expect(service.getBootstrapWorkerStatus()).resolves.toMatchObject({
      available: true,
      stale: false,
      queue: queueCounts,
    });
  });
});
