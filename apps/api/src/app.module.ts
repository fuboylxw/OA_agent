import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IrNormalizerModule } from './modules/ir-normalizer/ir-normalizer.module';
import { AdapterCompilerModule } from './modules/adapter-compiler/adapter-compiler.module';
import { ReplayValidatorModule } from './modules/replay-validator/replay-validator.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { ProcessLibraryModule } from './modules/process-library/process-library.module';
import { AuditModule } from './modules/audit/audit.module';
import { PermissionModule } from './modules/permission/permission.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { SubmissionModule } from './modules/submission/submission.module';
import { RuleModule } from './modules/rule/rule.module';
import { StatusModule } from './modules/status/status.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommonModule } from './modules/common/common.module';
import { MCPModule } from './modules/mcp/mcp.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'bootstrap' },
      { name: 'parse' },
      { name: 'submit' },
      { name: 'status' },
    ),
    CommonModule,
    BootstrapModule,
    DiscoveryModule,
    IrNormalizerModule,
    AdapterCompilerModule,
    ReplayValidatorModule,
    ConnectorModule,
    ProcessLibraryModule,
    AuditModule,
    PermissionModule,
    AssistantModule,
    RuleModule,
    SubmissionModule,
    StatusModule,
    DashboardModule,
    AuthModule,
    MCPModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
