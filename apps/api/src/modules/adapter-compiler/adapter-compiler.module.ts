import { Module } from '@nestjs/common';
import { AdapterCompilerService } from './adapter-compiler.service';

@Module({
  providers: [AdapterCompilerService],
  exports: [AdapterCompilerService],
})
export class AdapterCompilerModule {}
