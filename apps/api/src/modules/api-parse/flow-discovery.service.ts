import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { GenericHttpAdapter } from '../adapter-runtime/generic-http-adapter';

/**
 * 运行时流程发现服务
 *
 * 当初始化时只识别出"通用申请流程"（generic_application），
 * 本服务通过调用 OA 系统的流程列表接口（_system_flow_list MCPTool），
 * 动态发现具体的流程类型并自动创建 ProcessTemplate。
 *
 * 工作原理：
 *   1. 从 MCPTool 表找到 category='flow_list' 的工具
 *   2. 通过 GenericHttpAdapter 调用该接口
 *   3. 用 responseMapping 中的 listPath/code/name 解析响应
 *   4. 为每个发现的流程创建 ProcessTemplate（如果不存在）
 *   5. 缓存结果，避免重复调用
 */
@Injectable()
export class FlowDiscoveryService {
  private readonly logger = new Logger(FlowDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntime: AdapterRuntimeService,
  ) {}

  /**
   * 发现 connector 下所有可用的流程类型
   * 返回已有 + 新发现的流程列表
   */
  async discoverFlows(connectorId: string): Promise<DiscoveredFlow[]> {
    // 1. 找到 flow_list 工具
    const flowListTool = await this.prisma.mCPTool.findFirst({
      where: { connectorId, category: 'flow_list', enabled: true },
    });

    if (!flowListTool) {
      this.logger.log(`Connector ${connectorId}: no flow_list tool, skipping discovery`);
      return [];
    }

    // 2. 调用 OA 系统的流程列表接口
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
    });
    if (!connector) return [];

    let adapter;
    try {
      adapter = await this.adapterRuntime.createAdapterForConnector(connectorId);

      if (!('callEndpoint' in adapter)) {
        this.logger.log(`Connector ${connectorId}: adapter does not support callEndpoint`);
        return [];
      }

      const genericAdapter = adapter as GenericHttpAdapter;
      const response = await genericAdapter.callEndpoint(
        flowListTool.apiEndpoint,
        flowListTool.httpMethod,
        {},
      );

      // 3. 解析响应
      const mapping = flowListTool.responseMapping as any;
      const listPath = mapping?.listPath || 'data';
      const codeField = mapping?.code || 'code';
      const nameField = mapping?.name || 'name';
      const categoryField = mapping?.category || 'category';

      const items = this.extractField(response, listPath);
      if (!Array.isArray(items)) {
        this.logger.warn(`flow_list response at "${listPath}" is not an array`);
        return [];
      }

      // 4. 为每个流程创建 ProcessTemplate（如果不存在）
      const discovered: DiscoveredFlow[] = [];
      const tenantId = connector.tenantId;

      // 找到通用提交端点（generic_application 的 submit 工具）
      const genericSubmitTool = await this.prisma.mCPTool.findFirst({
        where: { connectorId, flowCode: 'generic_application', category: 'submit' },
      });

      for (const item of items) {
        const code = item[codeField];
        const name = item[nameField] || code;
        const category = item[categoryField] || '其他';

        if (!code) continue;

        const processCode = this.toProcessCode(code);

        // 检查是否已存在
        const existing = await this.prisma.processTemplate.findFirst({
          where: { connectorId, processCode },
        });

        if (existing) {
          discovered.push({
            processCode,
            processName: name,
            category,
            isNew: false,
            templateId: existing.id,
          });
          continue;
        }

        // 创建新的 ProcessTemplate
        const template = await this.prisma.processTemplate.create({
          data: {
            tenantId,
            connectorId,
            processCode,
            processName: name,
            processCategory: category,
            description: `${name}（运行时发现）`,
            version: 1,
            status: 'published',
            falLevel: 'F2',
            schema: {
              fields: [],
              submitEndpoint: genericSubmitTool?.apiEndpoint,
              submitMethod: genericSubmitTool?.httpMethod,
              flowTypeParam: codeField,
              flowTypeValue: code,
            },
            publishedAt: new Date(),
          },
        });

        discovered.push({
          processCode,
          processName: name,
          category,
          isNew: true,
          templateId: template.id,
        });

        this.logger.log(`Discovered flow: ${processCode} (${name})`);
      }

      this.logger.log(
        `Connector ${connectorId}: discovered ${discovered.length} flows (${discovered.filter(d => d.isNew).length} new)`,
      );

      return discovered;
    } catch (error: any) {
      this.logger.error(`Flow discovery failed for connector ${connectorId}: ${error.message}`);
      return [];
    } finally {
      if (adapter) {
        await this.adapterRuntime.destroyAdapter(adapter);
      }
    }
  }

  /**
   * 按关键词搜索流程（AI 对话时用）
   * 先查本地 ProcessTemplate，没有再触发远程发现
   */
  async findFlow(
    connectorId: string,
    keyword: string,
  ): Promise<DiscoveredFlow | null> {
    // 1. 先查本地
    const local = await this.prisma.processTemplate.findMany({
      where: {
        connectorId,
        status: 'published',
        OR: [
          { processName: { contains: keyword } },
          { processCode: { contains: keyword } },
          { description: { contains: keyword } },
        ],
      },
      take: 1,
    });

    if (local.length > 0) {
      return {
        processCode: local[0].processCode,
        processName: local[0].processName,
        category: local[0].processCategory || '其他',
        isNew: false,
        templateId: local[0].id,
      };
    }

    // 2. 本地没有，触发远程发现
    const allFlows = await this.discoverFlows(connectorId);
    if (allFlows.length === 0) return null;

    // 3. 从发现结果中模糊匹配
    const kw = keyword.toLowerCase();
    return allFlows.find(
      f => f.processName.toLowerCase().includes(kw) || f.processCode.toLowerCase().includes(kw),
    ) || null;
  }

  /**
   * 列出 connector 下所有已知流程（本地 + 远程发现）
   */
  async listAllFlows(connectorId: string): Promise<DiscoveredFlow[]> {
    // 先返回本地已有的
    const localTemplates = await this.prisma.processTemplate.findMany({
      where: { connectorId, status: 'published' },
      orderBy: { processName: 'asc' },
    });

    const result: DiscoveredFlow[] = localTemplates.map(t => ({
      processCode: t.processCode,
      processName: t.processName,
      category: t.processCategory || '其他',
      isNew: false,
      templateId: t.id,
    }));

    // 如果只有 generic_application 或没有流程，尝试远程发现
    const hasOnlyGeneric = result.length <= 1 &&
      result.every(r => r.processCode === 'generic_application');

    if (hasOnlyGeneric) {
      const discovered = await this.discoverFlows(connectorId);
      // 合并去重
      for (const d of discovered) {
        if (!result.find(r => r.processCode === d.processCode)) {
          result.push(d);
        }
      }
    }

    return result;
  }

  private extractField(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private toProcessCode(raw: string): string {
    return raw
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()
      .substring(0, 120) || 'unknown_flow';
  }
}

export interface DiscoveredFlow {
  processCode: string;
  processName: string;
  category: string;
  isNew: boolean;
  templateId: string;
}
