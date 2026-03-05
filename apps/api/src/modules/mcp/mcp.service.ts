import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class MCPService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all MCP tools for a connector
   */
  async listTools(connectorId: string, category?: string) {
    const where: any = { connectorId, enabled: true };
    if (category) {
      where.category = category;
    }

    return this.prisma.mCPTool.findMany({
      where,
      orderBy: [{ category: 'asc' }, { toolName: 'asc' }],
      select: {
        id: true,
        toolName: true,
        toolDescription: true,
        category: true,
        flowCode: true,
        enabled: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get a specific MCP tool
   */
  async getTool(connectorId: string, toolName: string) {
    const tool = await this.prisma.mCPTool.findFirst({
      where: { connectorId, toolName },
      include: { connector: true },
    });

    if (!tool) {
      throw new Error(`MCP tool ${toolName} not found for connector ${connectorId}`);
    }

    return tool;
  }

  /**
   * Get tools by flow code
   */
  async getToolsByFlow(connectorId: string, flowCode: string) {
    return this.prisma.mCPTool.findMany({
      where: {
        connectorId,
        flowCode,
        enabled: true,
      },
    });
  }

  /**
   * Get tool by category and flow
   */
  async getToolByCategory(
    connectorId: string,
    flowCode: string,
    category: string,
  ) {
    return this.prisma.mCPTool.findFirst({
      where: {
        connectorId,
        flowCode,
        category,
        enabled: true,
      },
    });
  }

  /**
   * Create MCP tool
   */
  async createTool(data: {
    tenantId: string;
    connectorId: string;
    toolName: string;
    toolDescription: string;
    toolSchema: any;
    apiEndpoint: string;
    httpMethod: string;
    headers?: any;
    bodyTemplate?: any;
    paramMapping: any;
    responseMapping: any;
    flowCode?: string;
    category: string;
    testInput?: any;
    testOutput?: any;
  }) {
    return this.prisma.mCPTool.create({ data });
  }

  /**
   * Update MCP tool
   */
  async updateTool(id: string, data: Partial<any>) {
    return this.prisma.mCPTool.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete MCP tool
   */
  async deleteTool(id: string) {
    return this.prisma.mCPTool.delete({ where: { id } });
  }

  /**
   * Enable/disable tool
   */
  async toggleTool(id: string, enabled: boolean) {
    return this.prisma.mCPTool.update({
      where: { id },
      data: { enabled },
    });
  }
}
