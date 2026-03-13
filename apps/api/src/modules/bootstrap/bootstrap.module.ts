import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../common/prisma.service';
import { WorkerAvailabilityService } from './worker-availability.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'bootstrap',
    }),
  ],
  controllers: [BootstrapController],
  providers: [
    BootstrapService,
    PrismaService,
    WorkerAvailabilityService,
  ],
  exports: [BootstrapService, WorkerAvailabilityService],
})
export class BootstrapModule {}
