import { Module } from '@nestjs/common';
import { AuthBindingController } from './auth-binding.controller';
import { AuthBindingService } from './auth-binding.service';

@Module({
  controllers: [AuthBindingController],
  providers: [AuthBindingService],
  exports: [AuthBindingService],
})
export class AuthBindingModule {}
