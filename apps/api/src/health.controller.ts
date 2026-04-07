import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Public } from './modules/common/public.decorator';
import { PrismaService } from './modules/common/prisma.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { WorkerAvailabilityService } from './modules/bootstrap/worker-availability.service';
import type { Response } from 'express';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workerAvailabilityService: WorkerAvailabilityService,
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: err.message };
    }

    // Redis
    const redisStart = Date.now();
    try {
      const pong = await this.bootstrapQueue.client.ping();
      checks.redis = { status: pong === 'PONG' ? 'ok' : 'error', latencyMs: Date.now() - redisStart };
    } catch (err: any) {
      checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, error: err.message };
    }

    // Worker heartbeat
    const bootstrapWorker = await this.workerAvailabilityService.getBootstrapWorkerStatus();
    checks.worker = {
      status: bootstrapWorker.available ? 'ok' : 'degraded',
      ...(bootstrapWorker.reason ? { error: bootstrapWorker.reason } : {}),
    };

    const allOk = Object.values(checks).every(c => c.status === 'ok');
    const hasCriticalFailure = checks.database?.status === 'error' || checks.redis?.status === 'error';
    const overallStatus = hasCriticalFailure ? 'error' : allOk ? 'ok' : 'degraded';

    // Return 503 when critical dependencies are down
    if (hasCriticalFailure) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: 'uniflow-oa-api',
      checks,
    };
  }

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    return this.ready(res);
  }
}
