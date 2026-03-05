import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'status' }),
    AuditModule,
  ],
  controllers: [StatusController],
  providers: [StatusService],
  exports: [StatusService],
})
export class StatusModule {}
