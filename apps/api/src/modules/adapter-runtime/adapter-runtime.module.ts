import { Module } from '@nestjs/common';
import { AdapterRuntimeService } from './adapter-runtime.service';
import { DelegatedCredentialModule } from '../delegated-credential/delegated-credential.module';
import { AuthBindingModule } from '../auth-binding/auth-binding.module';
import { OaBackendLoginService } from './oa-backend-login.service';

@Module({
  imports: [DelegatedCredentialModule, AuthBindingModule],
  providers: [AdapterRuntimeService, OaBackendLoginService],
  exports: [AdapterRuntimeService, OaBackendLoginService],
})
export class AdapterRuntimeModule {}
