import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { AuditModule } from '../audit/audit.module';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';

@Module({
  imports: [AuditModule, AdapterRuntimeModule],
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
