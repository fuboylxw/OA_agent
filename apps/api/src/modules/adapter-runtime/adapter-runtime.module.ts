import { Module } from '@nestjs/common';
import { AdapterRuntimeService } from './adapter-runtime.service';
import { DelegatedCredentialModule } from '../delegated-credential/delegated-credential.module';
import { AuthBindingModule } from '../auth-binding/auth-binding.module';

@Module({
  imports: [DelegatedCredentialModule, AuthBindingModule],
  providers: [AdapterRuntimeService],
  exports: [AdapterRuntimeService],
})
export class AdapterRuntimeModule {}
