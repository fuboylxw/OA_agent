import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { BootstrapStateMachine } from './bootstrap.state-machine';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';
import axios from 'axios';

@Injectable()
export class BootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: BootstrapStateMachine,
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async createJob(dto: CreateBootstrapJobDto) {
    const tenantId = process.env.DEFAULT_TENANT_ID || 'default-tenant';

    // If apiDocUrl is provided, fetch the content
    let apiDocContent = dto.apiDocContent;
    if (dto.apiDocUrl && !apiDocContent) {
      try {
        const response = await axios.get(dto.apiDocUrl, { timeout: 30000 });
        apiDocContent = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      } catch (error: any) {
        console.warn(`[Bootstrap] Failed to fetch API doc from ${dto.apiDocUrl}: ${error.message}`);
      }
    }

    // Create bootstrap job
    const job = await this.prisma.bootstrapJob.create({
      data: {
        tenantId,
        status: 'CREATED',
        oaUrl: dto.oaUrl,
        openApiUrl: dto.apiDocUrl,
      },
    });

    // Create bootstrap sources
    if (dto.oaUrl) {
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: 'oa_url',
          sourceUrl: dto.oaUrl,
        },
      });
    }

    if (dto.apiDocUrl) {
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: 'openapi',
          sourceUrl: dto.apiDocUrl,
        },
      });
    }

    // Store API doc content as a source if provided
    if (apiDocContent) {
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: dto.apiDocType || 'openapi',
          sourceContent: apiDocContent,
          metadata: {
            docType: dto.apiDocType || 'openapi',
            docUrl: dto.apiDocUrl,
          },
        },
      });
    }

    // Enqueue bootstrap job
    await this.bootstrapQueue.add('process', { jobId: job.id });

    return job;
  }

  async getJob(id: string) {
    return this.prisma.bootstrapJob.findUnique({
      where: { id },
      include: {
        sources: true,
        reports: true,
        flowIRs: true,
        fieldIRs: true,
        ruleIRs: true,
        permissionIRs: true,
        adapterBuilds: true,
        replayCases: {
          include: {
            replayResults: true,
          },
        },
      },
    });
  }

  async listJobs(tenantId: string) {
    return this.prisma.bootstrapJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        reports: true,
      },
    });
  }

  async getReport(jobId: string) {
    return this.prisma.bootstrapReport.findFirst({
      where: { bootstrapJobId: jobId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async publishJob(jobId: string) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: jobId },
      include: {
        flowIRs: true,
        fieldIRs: true,
        ruleIRs: true,
        permissionIRs: true,
        reports: true,
      },
    });

    if (!job) {
      throw new Error('Bootstrap job not found');
    }

    if (job.status !== 'REVIEW') {
      throw new Error('Job must be in REVIEW status to publish');
    }

    // Find the connector created during bootstrap
    const report = job.reports[0];
    const connector = await this.prisma.connector.findFirst({
      where: {
        tenantId: job.tenantId,
        createdAt: { gte: job.createdAt },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!connector) {
      throw new Error('Connector not found for this bootstrap job');
    }

    // Get MCP tools grouped by module
    const mcpTools = await this.prisma.mCPTool.findMany({
      where: { connectorId: connector.id },
    });

    // Group tools by module (extracted from toolDescription)
    const moduleMap = new Map<string, { title: string; tools: any[] }>();

    for (const tool of mcpTools) {
      const match = tool.toolDescription?.match(/^([^ ]+) - /);
      const moduleTitle = match ? match[1] : '其他';

      if (!moduleMap.has(moduleTitle)) {
        moduleMap.set(moduleTitle, { title: moduleTitle, tools: [] });
      }
      moduleMap.get(moduleTitle)!.tools.push(tool);
    }

    // Category mapping for O2OA modules
    const categoryMap: Record<string, string> = {
      '流程平台': '行政',
      '内容管理': '行政',
      '考勤管理': '人事',
      '组织管理': '人事',
      '文件管理': '行政',
      '会议管理': '行政',
      '论坛': '行政',
      '门户设计': '行政',
      '门户前端': '行政',
      '数据查询设计': '行政',
      '数据查询前端': '行政',
      '消息通信': '行政',
      '日历': '行政',
      '脑图': '行政',
      'AI': '其他',
      '程序中心': '其他',
      '认证/登录': '其他',
    };

    // Create process templates from modules
    let publishedCount = 0;
    for (const [moduleTitle, moduleData] of moduleMap) {
      // Skip modules with too few tools (likely not user-facing processes)
      if (moduleData.tools.length < 10) continue;

      // Generate a clean process code using pinyin or English
      const moduleCodeMap: Record<string, string> = {
        '流程平台': 'workflow_platform',
        '内容管理': 'content_management',
        '考勤管理': 'attendance',
        '组织管理': 'organization',
        '文件管理': 'file_management',
        '会议管理': 'meeting',
        '论坛': 'forum',
        '门户设计': 'portal_design',
        '门户前端': 'portal',
        '数据查询设计': 'query_design',
        '数据查询前端': 'query',
        '数据查询服务': 'query_service',
        '消息通信': 'message',
        '日历': 'calendar',
        '脑图': 'mindmap',
        'AI': 'ai',
        '程序中心': 'program_center',
        '认证/登录': 'auth',
        '组织快捷查询': 'org_express',
        '流程处理服务': 'workflow_service',
        '流程设计': 'workflow_design',
        '个人设置': 'personal',
        '流程监控': 'workflow_monitor',
        '通用': 'general',
        '热点': 'hotpic',
        '关联服务': 'correlation',
        '极光推送': 'jpush',
        '组件管理': 'component',
        '初始化': 'init',
      };

      const processCode = moduleCodeMap[moduleTitle] || `o2oa_${moduleTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      const category = categoryMap[moduleTitle] || '其他';

      // Check if already exists
      const existing = await this.prisma.processTemplate.findFirst({
        where: {
          tenantId: job.tenantId,
          connectorId: connector.id,
          processCode,
        },
      });

      if (existing) continue;

      // Count tool types
      const postCount = moduleData.tools.filter(t => t.httpMethod === 'POST').length;
      const getCount = moduleData.tools.filter(t => t.httpMethod === 'GET').length;

      // Determine FAL level based on tool capabilities
      let falLevel = 'F1';
      if (postCount >= 10 && getCount >= 20) falLevel = 'F3';
      else if (postCount >= 5 && getCount >= 10) falLevel = 'F2';

      await this.prisma.processTemplate.create({
        data: {
          tenantId: job.tenantId,
          connectorId: connector.id,
          processCode,
          processName: moduleTitle,
          processCategory: category,
          version: 1,
          status: 'published',
          falLevel,
          schema: {
            description: `${moduleTitle}相关操作，包含 ${moduleData.tools.length} 个 API 工具`,
            toolCount: moduleData.tools.length,
            capabilities: {
              create: postCount,
              read: getCount,
              update: moduleData.tools.filter(t => t.httpMethod === 'PUT').length,
              delete: moduleData.tools.filter(t => t.httpMethod === 'DELETE').length,
            },
          },
          rules: [],
          permissions: [],
          publishedAt: new Date(),
        },
      });

      publishedCount++;
    }

    // Update job status
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        status: 'PUBLISHED',
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      connectorId: connector.id,
      publishedTemplates: publishedCount,
    };
  }

  async transitionState(jobId: string, event: string) {
    const job = await this.prisma.bootstrapJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error('Job not found');

    const newState = this.stateMachine.transition(job.status, event);
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: newState },
    });

    return newState;
  }
}
