import { Module } from '@nestjs/common';
import { BootstrapModule } from '../bootstrap/bootstrap.module';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { DeliveryRuntimeModule } from '../delivery-runtime/delivery-runtime.module';
import { ProcessLibraryController } from './process-library.controller';
import { ProcessLibraryService } from './process-library.service';

@Module({
  imports: [BootstrapModule, AdapterRuntimeModule, DeliveryRuntimeModule],
  controllers: [ProcessLibraryController],
  providers: [ProcessLibraryService],
  exports: [ProcessLibraryService],
})
export class ProcessLibraryModule {}
