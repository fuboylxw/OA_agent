import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DelegatedCredentialModule } from '../delegated-credential/delegated-credential.module';

@Module({
  imports: [DelegatedCredentialModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
