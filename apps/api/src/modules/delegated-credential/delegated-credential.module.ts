import { Module } from '@nestjs/common';
import { DelegatedCredentialService } from './delegated-credential.service';

@Module({
  providers: [DelegatedCredentialService],
  exports: [DelegatedCredentialService],
})
export class DelegatedCredentialModule {}
