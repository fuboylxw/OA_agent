import { Module } from '@nestjs/common';
import { ReplayValidatorService } from './replay-validator.service';

@Module({
  providers: [ReplayValidatorService],
  exports: [ReplayValidatorService],
})
export class ReplayValidatorModule {}
