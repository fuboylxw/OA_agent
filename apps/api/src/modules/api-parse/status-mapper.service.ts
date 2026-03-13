import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StatusMappingConfig } from './types';

/**
 * 状态映射服务 — 将远端 OA 系统的状态值翻译为本地统一状态
 *
 * 映射规则存储在 Connector.statusMapping (JSON)，格式：
 * {
 *   statusFieldPath: "data.status",          // 从远端响应中取状态的 JSON path
 *   rules: [{ match: "approved", localStatus: "approved" }, ...],
 *   defaultStatus: "in_progress"
 * }
 */
@Injectable()
export class StatusMapperService {
  private readonly logger = new Logger(StatusMapperService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将远端原始响应映射为本地状态
   */
  mapStatus(
    remoteResponse: Record<string, any>,
    config: StatusMappingConfig | null | undefined,
  ): string {
    if (!config) return this.inferFromRaw(remoteResponse);

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

  /**
   * 加载 connector 的状态映射配置
   */
  async getConfig(connectorId: string): Promise<StatusMappingConfig | null> {
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
      select: { statusMapping: true },
    });
    return (connector?.statusMapping as unknown as StatusMappingConfig) || null;
  }

  /**
   * 无配置时的启发式推断
   */
  private inferFromRaw(response: Record<string, any>): string {
    // 尝试常见字段名
    const statusValue = response.status
      || response.state
      || response.processStatus
      || response.approvalStatus
      || response.data?.status
      || response.data?.state;

    if (!statusValue) return 'unknown';

    return this.normalizeStatus(String(statusValue));
  }

  /**
   * 将常见的 OA 状态值归一化为本地状态
   */
  private normalizeStatus(raw: string): string {
    const s = raw.toLowerCase().trim();

    // 已通过/已完成
    if (/^(approved|completed|done|finished|passed|accept|agreed|同意|通过|已完成|已通过)$/.test(s)) {
      return 'approved';
    }
    // 已拒绝
    if (/^(rejected|denied|refused|declined|disapproved|拒绝|驳回|不同意|已拒绝)$/.test(s)) {
      return 'rejected';
    }
    // 已取消
    if (/^(cancelled|canceled|withdrawn|revoked|撤回|取消|已撤回|已取消)$/.test(s)) {
      return 'cancelled';
    }
    // 处理中
    if (/^(processing|in_progress|pending_approval|approving|审批中|处理中|进行中|流转中)$/.test(s)) {
      return 'in_progress';
    }
    // 待提交/草稿
    if (/^(draft|pending|waiting|submitted|待处理|待审批|已提交|待办)$/.test(s)) {
      return 'submitted';
    }

    return 'in_progress';
  }

  /**
   * 规则匹配：支持精确匹配和简单通配符
   */
  private matchRule(remoteValue: string, pattern: string): boolean {
    const p = pattern.toLowerCase().trim();

    // 通配符 *
    if (p.includes('*')) {
      const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
      return regex.test(remoteValue);
    }

    return remoteValue === p;
  }

  /**
   * 从嵌套对象中按 dot-path 提取值
   */
  private extractField(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
