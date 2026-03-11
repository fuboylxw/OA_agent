import { Module } from '@nestjs/common';
import { AdapterRuntimeService } from './adapter-runtime.service';

@Module({
  providers: [AdapterRuntimeService],
  exports: [AdapterRuntimeService],
})
export class AdapterRuntimeModule {}
