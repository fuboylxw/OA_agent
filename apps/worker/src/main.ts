import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  // Worker reuses the API's WorkerModule which registers Bull processors
  const { WorkerModule } = await import('./worker.module');
  const app = await NestFactory.createApplicationContext(WorkerModule);

  logger.log('Worker started, processing queues: bootstrap, parse, submit, status');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.log('Worker shutting down...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
