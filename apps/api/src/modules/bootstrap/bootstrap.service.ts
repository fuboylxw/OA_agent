import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';
import axios from 'axios';

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async createJob(dto: CreateBootstrapJobDto) {
    const tenantId = dto.tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant';

    // If apiDocUrl is provided, fetch the content
    let apiDocContent = dto.apiDocContent;
    if (dto.apiDocUrl && !apiDocContent) {
      try {
        const response = await axios.get(dto.apiDocUrl, { timeout: 30000 });
        apiDocContent = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
        this.logger.log(`Successfully fetched API doc from ${dto.apiDocUrl}, length: ${apiDocContent.length}`);
      } catch (error: any) {
        this.logger.warn(`Failed to fetch API doc from ${dto.apiDocUrl}: ${error.message}`);
        throw new Error(`无法访问 API 文档链接: ${error.message}`);
      }
    }

    if (!apiDocContent && !dto.oaUrl) {
      throw new Error('请提供 API 文档链接、上传 API 文档或填写 OA 系统地址');
    }

    // 组装 authConfig JSON
    const authConfig = dto.authType
      ? { authType: dto.authType, ...(dto.authConfig || {}) }
      : null;

    // Create bootstrap job
    const job = await this.prisma.bootstrapJob.create({
      data: {
        tenantId,
        name: dto.name,
        status: 'CREATED',
        oaUrl: dto.oaUrl,
        openApiUrl: dto.apiDocUrl,
        authConfig: authConfig ?? undefined,
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

    // 唯一入队路径：Worker Processor 处理全部流水线
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

  /**
   * 重新激活已删除连接器的初始化任务
   * mode: 'reuse' — 复用旧文档直接重新解析发布
   * mode: 'new'   — 使用新上传的文档
   */
  async reactivate(
    jobId: string,
    mode: 'reuse' | 'new',
    newDoc?: { apiDocContent?: string; apiDocUrl?: string; apiDocType?: string },
  ) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: jobId },
      include: { sources: true },
    });

    if (!job) throw new Error('Bootstrap job not found');

    // 只有 PUBLISHED 且连接器还在的任务不允许重新激活
    if (job.connectorId && job.status === 'PUBLISHED') {
      throw new Error('该任务关联的连接器仍然存在，无需重新激活');
    }

    if (mode === 'new') {
      // 使用新文档：获取内容
      let docContent = newDoc?.apiDocContent;
      if (!docContent && newDoc?.apiDocUrl) {
        const response = await axios.get(newDoc.apiDocUrl, { timeout: 30000 });
        docContent = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      }
      if (!docContent) throw new Error('请提供新的 API 文档内容或链接');

      // 保存新文档为新的 BootstrapSource（旧的保留作为历史）
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: jobId,
          sourceType: newDoc?.apiDocType || 'openapi',
          sourceContent: docContent,
          metadata: {
            docType: newDoc?.apiDocType || 'openapi',
            docUrl: newDoc?.apiDocUrl,
            reactivatedAt: new Date().toISOString(),
          },
        },
      });
    } else {
      // 复用旧文档：确认有可用的历史文档
      const latestSource = job.sources
        .filter((s) => s.sourceContent)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (!latestSource?.sourceContent) {
        throw new Error('没有找到可复用的历史文档，请上传新文档');
      }
    }

    // 重置状态，通过 Bull 队列重新走 Worker 流水线
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: 'CREATED', completedAt: null, connectorId: null },
    });

    await this.bootstrapQueue.add('process', { jobId });

    return { jobId, mode, status: 'CREATED' };
  }

  /**
   * 彻底删除初始化任务及所有关联数据
   * BootstrapJob 的子表全部配置了 onDelete: Cascade，直接删即可
   */
  async deleteJob(jobId: string) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: jobId },
    });

    if (!job) throw new Error('Bootstrap job not found');

    // 如果关联的连接器还在，一起删掉
    if (job.connectorId) {
      await this.prisma.connector.delete({ where: { id: job.connectorId } });
    }

    // BootstrapJob 的所有子表均已配置 onDelete: Cascade：
    // BootstrapJob → BootstrapSource, BootstrapReport, FlowIR, FieldIR,
    //   RuleIR, PermissionIR, AdapterBuild, ReplayCase, DriftEvent,
    //   ParseJob → ExtractedProcess
    await this.prisma.bootstrapJob.delete({ where: { id: jobId } });

    return { deleted: true, jobId };
  }
}
