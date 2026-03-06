import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './services/prisma.service';
import { BootstrapProcessor } from './processors/bootstrap.processor';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'bootstrap' },
      { name: 'parse' },
      { name: 'submit' },
      { name: 'status' },
    ),
  ],
  providers: [PrismaService, BootstrapProcessor],
  exports: [PrismaService],
})
export class WorkerModule {}
