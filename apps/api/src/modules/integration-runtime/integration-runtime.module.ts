import { Module } from '@nestjs/common';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { AuthBindingModule } from '../auth-binding/auth-binding.module';
import { IntegrationRuntimeService } from './integration-runtime.service';

@Module({
  imports: [AdapterRuntimeModule, AuthBindingModule],
  providers: [IntegrationRuntimeService],
  exports: [IntegrationRuntimeService],
})
export class IntegrationRuntimeModule {}
