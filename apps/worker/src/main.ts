import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  // Worker reuses the API's WorkerModule which registers Bull processors
  const { WorkerModule } = await import('./worker.module');
  const app = await NestFactory.createApplicationContext(WorkerModule);

  console.log('🔧 Worker started, processing queues: bootstrap, parse, submit, status');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Worker shutting down...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
