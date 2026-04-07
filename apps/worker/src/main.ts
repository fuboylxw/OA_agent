import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { registerRuntimeDiagnosticsProcessHandlers } from '@uniflow/agent-kernel';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  process.env.APP_RUNTIME = 'worker';
  registerRuntimeDiagnosticsProcessHandlers('worker');
  const { WorkerModule } = await import('./worker.module');
  const app = await NestFactory.createApplicationContext(WorkerModule);

  app.enableShutdownHooks();

  logger.log('Worker started, processing queues: bootstrap, parse, submit, status, sync, webhook');

  // Graceful shutdown — handle both SIGTERM (Docker/K8s) and SIGINT (Ctrl+C)
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      logger.log('Worker shutdown complete');
    } catch (err) {
      logger.error('Error during shutdown', err);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
