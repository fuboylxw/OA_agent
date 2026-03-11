import { PrismaService } from '../common/prisma.service';
import type { EndpointDef, EndpointLoader } from './generic-http-adapter';

/**
 * PrismaEndpointLoader — 从数据库 MCPTool 表加载端点定义
 *
 * 这是 GenericHttpAdapter 的数据源。
 * 前端上传 API 文档后，MCPToolGeneratorService 会自动生成 MCPTool 记录，
 * 本 loader 在适配器 init() 时读取这些记录，转换为运行时端点定义。
 */
export class PrismaEndpointLoader implements EndpointLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadEndpoints(connectorId: string): Promise<EndpointDef[]> {
    const tools = await this.prisma.mCPTool.findMany({
      where: {
        connectorId,
        enabled: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return tools.map((tool) => ({
      toolName: tool.toolName,
      category: tool.category || 'other',
      apiEndpoint: tool.apiEndpoint,
      httpMethod: tool.httpMethod,
      headers: (tool.headers as Record<string, string>) || undefined,
      bodyTemplate: tool.bodyTemplate || undefined,
      paramMapping: (tool.paramMapping as Record<string, any>) || {},
      responseMapping: (tool.responseMapping as Record<string, any>) || {},
      flowCode: tool.flowCode || null,
    }));
  }
}
