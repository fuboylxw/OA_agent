import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StatusMappingConfig } from './types';

@Injectable()
export class StatusMapperService {
  private readonly logger = new Logger(StatusMapperService.name);

  constructor(private readonly prisma: PrismaService) {}

  mapStatus(
    remoteResponse: Record<string, any>,
    config: StatusMappingConfig | null | undefined,
  ): string {
    if (!config) {
      return this.inferFromRaw(remoteResponse);
    }

    const remoteValue = this.extractField(remoteResponse, config.statusFieldPath);
    if (remoteValue === undefined || remoteValue === null) {
      return config.defaultStatus || 'unknown';
    }

    const remoteStr = String(remoteValue).toLowerCase().trim();
    for (const rule of config.rules) {
      if (this.matchRule(remoteStr, rule.match)) {
        return rule.localStatus;
      }
    }

    return config.defaultStatus || 'unknown';
  }

  async getConfig(connectorId: string, tenantId: string): Promise<StatusMappingConfig | null> {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
      },
      select: { statusMapping: true },
    });
    return (connector?.statusMapping as unknown as StatusMappingConfig) || null;
  }

  private inferFromRaw(response: Record<string, any>): string {
    const statusValue =
      response.status ||
      response.state ||
      response.processStatus ||
      response.approvalStatus ||
      response.data?.status ||
      response.data?.state;

    if (!statusValue) {
      return 'unknown';
    }

    return this.normalizeStatus(String(statusValue));
  }

  private normalizeStatus(raw: string): string {
    const status = raw.toLowerCase().trim();

    if (/^(approved|completed|done|finished|passed|accept|agreed|同意|通过|已完成|已通过)$/.test(status)) {
      return 'approved';
    }
    if (/^(rejected|denied|refused|declined|disapproved|拒绝|驳回|不同意|已拒绝)$/.test(status)) {
      return 'rejected';
    }
    if (/^(cancelled|canceled|withdrawn|revoked|撤回|取消|已撤回|已取消)$/.test(status)) {
      return 'cancelled';
    }
    if (/^(processing|in_progress|pending_approval|approving|审批中|处理中|进行中|流转中)$/.test(status)) {
      return 'in_progress';
    }
    if (/^(draft|pending|waiting|submitted|待处理|待审批|已提交|待办)$/.test(status)) {
      return 'submitted';
    }

    this.logger.debug(`Falling back to in_progress for unmapped remote status "${raw}"`);
    return 'in_progress';
  }

  private matchRule(remoteValue: string, pattern: string): boolean {
    const normalizedPattern = pattern.toLowerCase().trim();
    if (normalizedPattern.includes('*')) {
      const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(remoteValue);
    }

    return remoteValue === normalizedPattern;
  }

  private extractField(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
