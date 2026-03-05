import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApiDocumentParserAgent, ParseDocumentOptions } from './agents/api-document-parser.agent';
import { createHash } from 'crypto';

export interface CreateParseJobDto {
  bootstrapJobId: string;
  documentType: string;
  documentUrl?: string;
  documentContent?: string;
  parseOptions?: ParseDocumentOptions;
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parserAgent: ApiDocumentParserAgent,
  ) {}

  /**
   * 创建解析任务
   */
  async createParseJob(dto: CreateParseJobDto) {
    this.logger.log(`创建解析任务: ${dto.bootstrapJobId}`);

    // 验证文档类型
    const supportedTypes = ['openapi', 'swagger', 'postman', 'har'];
    if (!supportedTypes.includes(dto.documentType)) {
      throw new Error(`不支持的文档类型: ${dto.documentType}`);
    }

    // 获取文档内容
    let documentContent: string;
    if (dto.documentContent) {
      documentContent = dto.documentContent;
    } else if (dto.documentUrl) {
      documentContent = await this.fetchDocument(dto.documentUrl);
    } else {
      throw new Error('必须提供documentContent或documentUrl');
    }

    // 计算文档哈希
    const documentHash = this.calculateHash(documentContent);

    // 检查是否已存在相同文档的解析结果（缓存）
    const existing = await this.prisma.parseJob.findFirst({
      where: {
        bootstrapJobId: dto.bootstrapJobId,
        documentHash,
        status: 'COMPLETED',
      },
    });

    if (existing) {
      this.logger.log(`找到缓存的解析结果: ${existing.id}`);
      return existing;
    }

    // 创建解析任务
    const parseJob = await this.prisma.parseJob.create({
      data: {
        bootstrapJobId: dto.bootstrapJobId,
        documentType: dto.documentType,
        documentUrl: dto.documentUrl,
        documentHash,
        status: 'PENDING',
        progress: 0,
        parseOptions: dto.parseOptions || {},
        warnings: [],
        errors: [],
      },
    });

    // 异步执行解析（加入队列）
    this.executeParseAsync(parseJob.id, documentContent, dto.parseOptions);

    return parseJob;
  }

  /**
   * 异步执行解析
   */
  private async executeParseAsync(
    parseJobId: string,
    documentContent: string,
    options?: ParseDocumentOptions,
  ) {
    try {
      // 更新状态为PARSING
      await this.prisma.parseJob.update({
        where: { id: parseJobId },
        data: { status: 'PARSING', progress: 10 },
      });

      // 调用Agent解析
      const parseJob = await this.prisma.parseJob.findUnique({
        where: { id: parseJobId },
      });

      const result = await this.parserAgent.parseDocument(
        documentContent,
        parseJob.documentType,
        options,
      );

      // 更新进度
      await this.prisma.parseJob.update({
        where: { id: parseJobId },
        data: { progress: 80 },
      });

      // 保存解析结果
      await this.saveParseResult(parseJobId, result);

      // 检查是否需要人工审核
      const needsReview = this.checkNeedsReview(result, options);
      const finalStatus = needsReview ? 'REVIEW_REQUIRED' : 'COMPLETED';

      // 更新最终状态
      await this.prisma.parseJob.update({
        where: { id: parseJobId },
        data: {
          status: finalStatus,
          progress: 100,
          parseResult: result as any,
          parseMetadata: result.metadata as any,
          warnings: result.warnings as any,
          completedAt: new Date(),
        },
      });

      this.logger.log(`解析任务完成: ${parseJobId}, 状态: ${finalStatus}`);
    } catch (error) {
      this.logger.error(`解析任务失败: ${parseJobId}`, error.stack);

      await this.prisma.parseJob.update({
        where: { id: parseJobId },
        data: {
          status: 'FAILED',
          errors: [
            {
              message: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString(),
            },
          ] as any,
        },
      });
    }
  }

  /**
   * 保存解析结果到ExtractedProcess表
   */
  private async saveParseResult(parseJobId: string, result: any) {
    const processes = result.processes || [];

    for (const process of processes) {
      await this.prisma.extractedProcess.create({
        data: {
          parseJobId,
          processCode: process.processCode,
          processName: process.processName,
          processCategory: process.processCategory,
          description: process.description,
          confidence: process.confidence,
          endpoints: process.endpoints as any,
          fields: process.fields as any,
          status: 'EXTRACTED',
        },
      });
    }

    this.logger.log(`保存${processes.length}个提取的流程`);
  }

  /**
   * 检查是否需要人工审核
   */
  private checkNeedsReview(result: any, options?: ParseDocumentOptions): boolean {
    const threshold = options?.confidenceThreshold || 0.8;

    // 检查是否有低置信度的流程
    const hasLowConfidence = result.processes.some(
      (p: any) => p.confidence < threshold,
    );

    // 检查是否有警告
    const hasWarnings = result.warnings && result.warnings.length > 0;

    return hasLowConfidence || hasWarnings;
  }

  /**
   * 获取解析状态
   */
  async getParseStatus(bootstrapJobId: string, parseJobId?: string) {
    const where: any = { bootstrapJobId };
    if (parseJobId) {
      where.id = parseJobId;
    }

    const parseJob = await this.prisma.parseJob.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!parseJob) {
      throw new Error('解析任务不存在');
    }

    // 计算结果统计
    const result = parseJob.parseResult as any;
    const stats = result
      ? {
          totalEndpoints: this.countEndpoints(result.processes),
          parsedEndpoints: this.countEndpoints(result.processes),
          extractedProcesses: result.processes?.length || 0,
          extractedFields: this.countFields(result.processes),
          confidence: this.calculateAverageConfidence(result.processes),
          warnings: result.warnings || [],
        }
      : null;

    return {
      parseJobId: parseJob.id,
      status: parseJob.status,
      progress: parseJob.progress,
      result: stats,
      startedAt: parseJob.createdAt,
      completedAt: parseJob.completedAt,
    };
  }

  /**
   * 获取解析结果详情
   */
  async getParseResult(bootstrapJobId: string) {
    const parseJob = await this.prisma.parseJob.findFirst({
      where: { bootstrapJobId },
      orderBy: { createdAt: 'desc' },
    });

    if (!parseJob) {
      throw new Error('解析任务不存在');
    }

    if (parseJob.status !== 'COMPLETED' && parseJob.status !== 'REVIEW_REQUIRED') {
      throw new Error(`解析任务未完成，当前状态: ${parseJob.status}`);
    }

    // 获取提取的流程
    const extractedProcesses = await this.prisma.extractedProcess.findMany({
      where: { parseJobId: parseJob.id },
    });

    const result = parseJob.parseResult as any;

    return {
      parseJobId: parseJob.id,
      documentInfo: {
        type: parseJob.documentType,
        url: parseJob.documentUrl,
      },
      extractedProcesses: extractedProcesses.map((ep) => ({
        id: ep.id,
        processCode: ep.processCode,
        processName: ep.processName,
        processCategory: ep.processCategory,
        description: ep.description,
        confidence: ep.confidence,
        endpoints: ep.endpoints,
        fields: ep.fields,
        status: ep.status,
      })),
      fieldMapping: result?.fieldMapping,
      warnings: parseJob.warnings,
      metadata: parseJob.parseMetadata,
    };
  }

  /**
   * 确认并发布解析结果
   */
  async confirmAndPublish(
    bootstrapJobId: string,
    parseJobId: string,
    modifications?: any[],
    comment?: string,
  ) {
    this.logger.log(`确认并发布解析结果: ${parseJobId}`);

    const parseJob = await this.prisma.parseJob.findUnique({
      where: { id: parseJobId },
    });

    if (!parseJob) {
      throw new Error('解析任务不存在');
    }

    // 应用修改
    if (modifications && modifications.length > 0) {
      await this.applyModifications(parseJobId, modifications);
    }

    // 获取所有提取的流程
    const extractedProcesses = await this.prisma.extractedProcess.findMany({
      where: { parseJobId },
    });

    // 发布到流程库
    const publishedTemplateIds: string[] = [];
    for (const process of extractedProcesses) {
      const templateId = await this.publishToProcessLibrary(process);
      publishedTemplateIds.push(templateId);

      // 更新状态
      await this.prisma.extractedProcess.update({
        where: { id: process.id },
        data: {
          status: 'PUBLISHED',
          publishedTemplateId: templateId,
        },
      });
    }

    // 更新ParseJob状态
    await this.prisma.parseJob.update({
      where: { id: parseJobId },
      data: {
        reviewedAt: new Date(),
        reviewComment: comment,
      },
    });

    this.logger.log(`发布完成，共${publishedTemplateIds.length}个流程模板`);

    return {
      publishedProcesses: extractedProcesses.length,
      publishedFields: this.countFields(extractedProcesses),
      publishedTemplateIds,
    };
  }

  /**
   * 应用人工修改
   */
  private async applyModifications(parseJobId: string, modifications: any[]) {
    for (const mod of modifications) {
      const process = await this.prisma.extractedProcess.findFirst({
        where: {
          parseJobId,
          processCode: mod.processCode,
        },
      });

      if (!process) {
        this.logger.warn(`流程不存在: ${mod.processCode}`);
        continue;
      }

      // 应用字段修改
      if (mod.fieldCode && mod.changes) {
        const fields = process.fields as any[];
        const fieldIndex = fields.findIndex((f) => f.fieldCode === mod.fieldCode);

        if (fieldIndex >= 0) {
          fields[fieldIndex] = { ...fields[fieldIndex], ...mod.changes };

          await this.prisma.extractedProcess.update({
            where: { id: process.id },
            data: { fields: fields as any },
          });
        }
      }
    }
  }

  /**
   * 发布到流程库
   */
  private async publishToProcessLibrary(process: any): Promise<string> {
    // 获取bootstrap job信息
    const parseJob = await this.prisma.parseJob.findUnique({
      where: { id: process.parseJobId },
      include: { bootstrapJob: true },
    });

    const tenantId = parseJob.bootstrapJob.tenantId;

    // 创建ProcessTemplate
    const template = await this.prisma.processTemplate.create({
      data: {
        tenantId,
        processCode: process.processCode,
        processName: process.processName,
        processCategory: process.processCategory,
        description: process.description,
        version: 1,
        status: 'published',
        falLevel: 'F3', // 默认F3
        fields: process.fields,
        endpoints: process.endpoints,
        rules: [],
      },
    });

    this.logger.log(`发布流程模板: ${template.processCode} (${template.id})`);

    return template.id;
  }

  /**
   * 重新解析
   */
  async reparse(
    bootstrapJobId: string,
    parseJobId: string,
    newOptions?: ParseDocumentOptions,
    focusEndpoints?: string[],
  ) {
    this.logger.log(`重新解析: ${parseJobId}`);

    const oldParseJob = await this.prisma.parseJob.findUnique({
      where: { id: parseJobId },
    });

    if (!oldParseJob) {
      throw new Error('解析任务不存在');
    }

    // 获取原始文档内容
    let documentContent: string;
    if (oldParseJob.documentUrl) {
      documentContent = await this.fetchDocument(oldParseJob.documentUrl);
    } else {
      throw new Error('无法获取原始文档内容');
    }

    // 如果指定了focusEndpoints，过滤文档
    if (focusEndpoints && focusEndpoints.length > 0) {
      documentContent = this.filterDocumentByEndpoints(
        documentContent,
        focusEndpoints,
      );
    }

    // 创建新的解析任务
    return this.createParseJob({
      bootstrapJobId,
      documentType: oldParseJob.documentType,
      documentContent,
      parseOptions: newOptions || (oldParseJob.parseOptions as any),
    });
  }

  // ========== 辅助方法 ==========

  private async fetchDocument(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取文档失败: ${response.statusText}`);
    }
    return response.text();
  }

  private calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private countEndpoints(processes: any[]): number {
    if (!processes) return 0;
    return processes.reduce((sum, p) => sum + (p.endpoints?.length || 0), 0);
  }

  private countFields(processes: any[]): number {
    if (!processes) return 0;
    return processes.reduce((sum, p) => sum + (p.fields?.length || 0), 0);
  }

  private calculateAverageConfidence(processes: any[]): number {
    if (!processes || processes.length === 0) return 0;
    const sum = processes.reduce((s, p) => s + (p.confidence || 0), 0);
    return Math.round((sum / processes.length) * 100) / 100;
  }

  private filterDocumentByEndpoints(
    documentContent: string,
    endpoints: string[],
  ): string {
    try {
      const doc = JSON.parse(documentContent);
      const filtered = { ...doc };

      if (doc.paths) {
        filtered.paths = {};
        endpoints.forEach((endpoint) => {
          if (doc.paths[endpoint]) {
            filtered.paths[endpoint] = doc.paths[endpoint];
          }
        });
      }

      return JSON.stringify(filtered, null, 2);
    } catch (e) {
      this.logger.warn('过滤文档失败，返回原始内容');
      return documentContent;
    }
  }
}