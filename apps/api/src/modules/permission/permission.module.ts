import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { AuditModule } from '../audit/audit.module';
import { IntegrationRuntimeModule } from '../integration-runtime/integration-runtime.module';

@Module({
  imports: [AuditModule, IntegrationRuntimeModule],
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
