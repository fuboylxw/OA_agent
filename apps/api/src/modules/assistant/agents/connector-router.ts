import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';

/**
 * ConnectorInfo — 连接器摘要，用于路由决策
 */
export interface ConnectorInfo {
  id: string;
  name: string;
  oaVendor?: string | null;
  oaType: string;
}

/**
 * ConnectorRouteResult — 路由结果
 */
export interface ConnectorRouteResult {
  /** 选中的 connectorId，null 表示需要用户澄清 */
  connectorId: string | null;
  /** 选中的 connector 名称 */
  connectorName?: string;
  /** 是否需要用户选择 */
  needsSelection: boolean;
  /** 给用户的选择提示 */
  selectionQuestion?: string;
  /** 候选 connector 列表（needsSelection=true 时） */
  candidates?: Array<{ id: string; name: string }>;
}

const CONNECTOR_ROUTE_SYSTEM_PROMPT = `你是一个 OA 系统路由助手。

## 任务
根据用户消息，判断用户想使用哪个 OA 系统。

## 规则
1. 如果只有一个系统，直接选它
2. 如果用户消息中明确提到了某个系统的名称或关键词，选那个系统
3. 如果无法判断，返回 needsSelection=true，列出可选系统让用户选择
4. 不要猜测，宁可让用户选择也不要选错

## 输出格式（JSON）
确定系统：
{ "matched": true, "connectorId": "xxx", "connectorName": "总部OA" }

需要用户选择：
{ "matched": false, "question": "您想在哪个系统中办理？\\n1. 总部OA\\n2. 分公司OA" }`;

@Injectable()
export class ConnectorRouter {
  private readonly logger = new Logger(ConnectorRouter.name);
  private llmClient = LLMClientFactory.createFromEnv();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 路由到正确的 connector。
   *
   * 决策优先级：
   *   1. 租户只有 1 个 active connector → 直接选它
   *   2. 用户有 session 上下文中的 connector → 沿用
   *   3. 用户部门/角色有默认 connector 绑定 → 用它
   *   4. 多个 connector → LLM 判断或让用户选
   */
  async route(
    tenantId: string,
    userId: string,
    message: string,
    sessionConnectorId?: string | null,
  ): Promise<ConnectorRouteResult> {
    // 获取租户下所有 active connector
    const connectors = await this.prisma.connector.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, name: true, oaVendor: true, oaType: true },
      orderBy: { createdAt: 'asc' },
    });

    if (connectors.length === 0) {
      return {
        connectorId: null,
        needsSelection: true,
        selectionQuestion: '当前没有可用的 OA 系统，请先通过初始化中心接入。',
        candidates: [],
      };
    }

    // 1. 只有一个 connector → 直接选
    if (connectors.length === 1) {
      return {
        connectorId: connectors[0].id,
        connectorName: connectors[0].name,
        needsSelection: false,
      };
    }

    // 2. session 上下文中有 connector → 沿用（同一会话中保持一致）
    if (sessionConnectorId) {
      const match = connectors.find(c => c.id === sessionConnectorId);
      if (match) {
        return {
          connectorId: match.id,
          connectorName: match.name,
          needsSelection: false,
        };
      }
    }

    // 3. 尝试按用户部门自动路由
    const autoRouted = await this.autoRouteByUser(userId, connectors);
    if (autoRouted) {
      return autoRouted;
    }

    // 4. 多个 connector → LLM 判断或让用户选
    return this.routeWithLLM(message, connectors, {
      tenantId,
      userId,
      sessionConnectorId,
    });
  }

  /**
   * 按用户信息自动路由（部门、最近使用等）
   */
  private async autoRouteByUser(
    userId: string,
    connectors: ConnectorInfo[],
  ): Promise<ConnectorRouteResult | null> {
    // 查用户最近一次提交，再通过 templateId 找到 connectorId
    const recentSubmission = await this.prisma.submission.findFirst({
      where: { userId },
      select: { templateId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (recentSubmission?.templateId) {
      const template = await this.prisma.processTemplate.findUnique({
        where: { id: recentSubmission.templateId },
        select: { connectorId: true },
      });

      if (template?.connectorId) {
        const match = connectors.find(c => c.id === template.connectorId);
        if (match) {
          this.logger.log(`Auto-routed to "${match.name}" based on user's recent submission`);
          return {
            connectorId: match.id,
            connectorName: match.name,
            needsSelection: false,
          };
        }
      }
    }

    return null;
  }

  /**
   * LLM 辅助路由
   */
  private async routeWithLLM(
    message: string,
    connectors: ConnectorInfo[],
    context: {
      tenantId: string;
      userId: string;
      sessionConnectorId?: string | null;
    },
  ): Promise<ConnectorRouteResult> {
    try {
      const connectorList = connectors
        .map(c => `- id: ${c.id} | 名称: ${c.name} | 厂商: ${c.oaVendor || '未知'} | 类型: ${c.oaType}`)
        .join('\n');

      const messages: LLMMessage[] = [
        { role: 'system', content: CONNECTOR_ROUTE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `可用 OA 系统：\n${connectorList}\n\n用户消息："${message}"\n\n请判断用户想使用哪个系统，返回 JSON。`,
        },
      ];

      const response = await this.llmClient.chat(messages, {
        trace: {
          scope: 'assistant.connector.route',
          tenantId: context.tenantId,
          userId: context.userId,
          metadata: {
            connectorCount: connectors.length,
            sessionConnectorId: context.sessionConnectorId || null,
          },
        },
      });

      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const result = JSON.parse(jsonStr);

      if (result.matched && result.connectorId) {
        const match = connectors.find(c => c.id === result.connectorId);
        if (match) {
          this.logger.log(`LLM routed to connector: ${match.name}`);
          return {
            connectorId: match.id,
            connectorName: match.name,
            needsSelection: false,
          };
        }
      }

      // LLM 无法确定 → 让用户选
      return this.buildSelectionResult(connectors, result.question);
    } catch (error: any) {
      this.logger.warn(`LLM connector routing failed, asking user: ${error.message}`);
      return this.buildSelectionResult(connectors);
    }
  }

  private buildSelectionResult(
    connectors: ConnectorInfo[],
    customQuestion?: string,
  ): ConnectorRouteResult {
    const question = customQuestion
      || `您想在哪个系统中办理？\n${connectors.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`;

    return {
      connectorId: null,
      needsSelection: true,
      selectionQuestion: question,
      candidates: connectors.map(c => ({ id: c.id, name: c.name })),
    };
  }
}
