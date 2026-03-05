import { Module } from '@nestjs/common';
import { IrNormalizerService } from './ir-normalizer.service';

@Module({
  providers: [IrNormalizerService],
  exports: [IrNormalizerService],
})
export class IrNormalizerModule {}
