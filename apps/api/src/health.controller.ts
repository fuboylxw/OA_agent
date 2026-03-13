import { Controller, Get } from '@nestjs/common';
import { WorkerAvailabilityService } from './modules/bootstrap/worker-availability.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly workerAvailabilityService: WorkerAvailabilityService,
  ) {}

  @Get()
  async check() {
    const bootstrapWorker = await this.workerAvailabilityService.getBootstrapWorkerStatus();

    return {
      status: bootstrapWorker.available ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'uniflow-oa-api',
      workers: {
        bootstrap: bootstrapWorker,
      },
    };
  }
}
