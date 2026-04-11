import { Module } from '@nestjs/common';
import { RuleService } from './rule.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [RuleService],
  exports: [RuleService],
})
export class RuleModule {}
