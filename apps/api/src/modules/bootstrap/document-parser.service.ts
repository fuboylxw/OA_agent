import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ApiDocumentParserAgent, ParseDocumentOptions } from './agents/api-document-parser.agent';
import { createHash } from 'crypto';
import axios from 'axios';

export interface CreateParseJobDto {
  tenantId: string;
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
        tenantId: dto.tenantId,
        bootstrapJobId: dto.bootstrapJobId,
        documentType: dto.documentType,
        documentUrl: dto.documentUrl,
        documentHash,
        status: 'PENDING',
        progress: 0,
        parseOptions: dto.parseOptions || {} as any,
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

      // 更新 bootstrap job 状态为 PARSING
      await this.prisma.bootstrapJob.update({
        where: { id: parseJob.bootstrapJobId },
        data: { status: 'PARSING' },
      });

      // 尝试从 OA 系统拉取真实流程模板数据，丰富文档内容
      let enrichedContent = documentContent;
      const bootstrapJob = await this.prisma.bootstrapJob.findUnique({
        where: { id: parseJob.bootstrapJobId },
      });
      if (bootstrapJob?.oaUrl) {
        enrichedContent = await this.enrichWithLiveFormData(documentContent, bootstrapJob.oaUrl);
      }

      const result = await this.parserAgent.parseDocument(
        enrichedContent,
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

      // 自动发布到流程库并更新 bootstrap job 状态
      await this.autoPublishAndUpdateBootstrapJob(parseJobId, parseJob.bootstrapJobId);
    } catch (error) {
      this.logger.error(`解析任务失败: ${parseJobId}`, error.stack);

      // 获取 bootstrapJobId 用于更新状态
      const parseJob = await this.prisma.parseJob.findUnique({
        where: { id: parseJobId },
      });

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

      // 更新 bootstrap job 状态为 FAILED
      if (parseJob) {
        await this.prisma.bootstrapJob.update({
          where: { id: parseJob.bootstrapJobId },
          data: { status: 'FAILED' },
        });
      }
    }
  }

  /**
   * 解析完成后自动发布到流程库并更新 bootstrap job 状态
   */
  private async autoPublishAndUpdateBootstrapJob(parseJobId: string, bootstrapJobId: string) {
    try {
      // 获取所有提取的流程
      const extractedProcesses = await this.prisma.extractedProcess.findMany({
        where: { parseJobId },
      });

      if (extractedProcesses.length === 0) {
        this.logger.warn(`解析任务 ${parseJobId} 没有提取到流程，标记为 FAILED`);
        await this.prisma.bootstrapJob.update({
          where: { id: bootstrapJobId },
          data: { status: 'FAILED' },
        });
        return;
      }

      // 更新 bootstrap job 状态为 COMPILING
      await this.prisma.bootstrapJob.update({
        where: { id: bootstrapJobId },
        data: { status: 'COMPILING' },
      });

      // 发布每个流程到流程库
      let publishedCount = 0;
      for (const process of extractedProcesses) {
        try {
          const templateId = await this.publishToProcessLibrary(process);
          await this.prisma.extractedProcess.update({
            where: { id: process.id },
            data: { status: 'PUBLISHED', publishedTemplateId: templateId },
          });
          publishedCount++;
        } catch (err) {
          this.logger.warn(`发布流程 ${process.processCode} 失败: ${err.message}`);
        }
      }

      // 更新 bootstrap job 为最终状态
      if (publishedCount > 0) {
        await this.prisma.bootstrapJob.update({
          where: { id: bootstrapJobId },
          data: { status: 'PUBLISHED', completedAt: new Date() },
        });
        this.logger.log(`Bootstrap job ${bootstrapJobId} 完成，发布了 ${publishedCount} 个流程到流程库`);
      } else {
        await this.prisma.bootstrapJob.update({
          where: { id: bootstrapJobId },
          data: { status: 'FAILED' },
        });
        this.logger.warn(`Bootstrap job ${bootstrapJobId} 所有流程发布失败`);
      }
    } catch (error) {
      this.logger.error(`自动发布失败: ${error.message}`, error.stack);
      await this.prisma.bootstrapJob.update({
        where: { id: bootstrapJobId },
        data: { status: 'FAILED' },
      });
    }
  }

  /**
   * 从 OA 系统拉取真实流程模板数据，合并到 API 文档中
   * 解决通用申请接口（POST /api/applications）只有一个 example 导致 LLM 只识别出一个流程的问题
   */
  private async enrichWithLiveFormData(documentContent: string, oaUrl: string): Promise<string> {
    this.logger.log(`尝试从 OA 系统 ${oaUrl} 拉取流程模板数据`);

    try {
      // 1. 尝试登录获取 session
      const loginRes = await axios.post(
        `${oaUrl}/api/auth/login`,
        { username: 'admin', password: 'Admin@123' },
        { timeout: 10000, withCredentials: true },
      );

      const cookies = loginRes.headers['set-cookie'];
      const cookieHeader = cookies ? cookies.map((c: string) => c.split(';')[0]).join('; ') : '';

      // 2. 拉取流程模板列表
      const formsRes = await axios.get(`${oaUrl}/api/forms`, {
        timeout: 10000,
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      });

      const forms = formsRes.data?.forms;
      if (!forms || !Array.isArray(forms) || forms.length === 0) {
        this.logger.warn('OA 系统未返回流程模板数据');
        return documentContent;
      }

      this.logger.log(`从 OA 系统获取到 ${forms.length} 个流程模板: ${forms.map((f: any) => f.name).join(', ')}`);

      // 3. 将流程模板数据追加到文档内容中
      const formsSection = `

=== OA 系统实际流程模板数据（来自 GET /api/forms 接口的真实返回） ===
以下是 OA 系统中实际注册的所有流程模板，每个流程通过 POST /api/applications 接口提交，
使用 formCode 字段区分不同流程类型。请为每个流程模板都生成对应的 process 定义。

${JSON.stringify(forms, null, 2)}

=== 重要说明 ===
- 上面每个 form 对象就是一个独立的业务流程
- formCode 对应 processCode（需转为大写下划线格式）
- fields 数组包含了每个流程的完整字段定义
- workflow 数组包含了审批流程步骤
- 所有流程共用 POST /api/applications 接口提交，通过 formCode 区分
- 请确保为每一个 form 都生成对应的 process，不要遗漏
`;

      return documentContent + formsSection;
    } catch (error) {
      this.logger.warn(`从 OA 系统拉取流程模板失败: ${error.message}，使用原始文档继续解析`);
      return documentContent;
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
      include: {
        bootstrapJob: {
          include: {
            tenant: {
              include: {
                connectors: true
              }
            }
          }
        }
      },
    });

    const tenantId = parseJob.bootstrapJob.tenantId;

    // 获取或创建连接器（使用 bootstrap job 的真实 OA 信息）
    const bootstrapJob = parseJob.bootstrapJob;
    let connector = parseJob.bootstrapJob.tenant.connectors[0];
    if (!connector) {
      const connectorName = bootstrapJob.name || 'OA Connector';
      const baseUrl = bootstrapJob.oaUrl || 'http://localhost';

      connector = await this.prisma.$transaction(async (tx) => {
        const createdConnector = await tx.connector.create({
          data: {
            tenantId,
            name: connectorName,
            oaType: 'openapi',
            baseUrl,
            authType: 'apikey',
            authConfig: {},
            oclLevel: 'OCL3',
          },
        });
        await tx.connectorCapability.create({
          data: {
            tenantId,
            connectorId: createdConnector.id,
            supportsDiscovery: true,
            supportsSchemaSync: true,
            supportsReferenceSync: true,
            supportsStatusPull: true,
            supportsCancel: true,
            supportsUrge: true,
            syncModes: ['full'],
            metadata: {
              inferredFrom: 'document_parser_default_connector',
            },
          },
        });
        return createdConnector;
      });

      // 回写 connectorId 到 BootstrapJob
      await this.prisma.bootstrapJob.update({
        where: { id: bootstrapJob.id },
        data: { connectorId: connector.id },
      });
    }

    const sourceHash = this.calculateHash(JSON.stringify({
      processCode: process.processCode,
      processName: process.processName,
      description: process.description,
      endpoints: process.endpoints,
      fields: process.fields,
    }));
    const remoteProcess = await this.prisma.remoteProcess.upsert({
      where: {
        connectorId_remoteProcessId: {
          connectorId: connector.id,
          remoteProcessId: process.processCode,
        },
      },
      create: {
        tenantId,
        connectorId: connector.id,
        remoteProcessId: process.processCode,
        remoteProcessCode: process.processCode,
        remoteProcessName: process.processName,
        processCategory: process.processCategory,
        sourceHash,
        sourceVersion: '1',
        metadata: {
          extractedFrom: 'document_parser',
        },
        lastSchemaSyncAt: new Date(),
        lastDriftCheckAt: new Date(),
      },
      update: {
        remoteProcessCode: process.processCode,
        remoteProcessName: process.processName,
        processCategory: process.processCategory,
        sourceHash,
        metadata: {
          extractedFrom: 'document_parser',
        },
        lastSchemaSyncAt: new Date(),
        lastDriftCheckAt: new Date(),
      },
    });
    const latestTemplate = await this.prisma.processTemplate.findFirst({
      where: {
        connectorId: connector.id,
        processCode: process.processCode,
      },
      orderBy: {
        version: 'desc',
      },
    });
    const nextVersion = latestTemplate ? latestTemplate.version + 1 : 1;

    // 创建ProcessTemplate
    const template = await this.prisma.processTemplate.create({
      data: {
        tenantId,
        connectorId: connector.id,
        remoteProcessId: remoteProcess.id,
        processCode: process.processCode,
        processName: process.processName,
        processCategory: process.processCategory,
        description: process.description,
        version: nextVersion,
        status: 'published',
        falLevel: 'F3', // 默认F3
        sourceHash,
        sourceVersion: String(nextVersion),
        schema: {
          fields: process.fields,
        },
        uiHints: {
          endpoints: process.endpoints,
        },
        rules: null,
        permissions: null,
        lastSyncedAt: new Date(),
        publishedAt: new Date(),
      },
    });

    await this.prisma.remoteProcess.update({
      where: { id: remoteProcess.id },
      data: {
        latestTemplateId: template.id,
        sourceVersion: String(nextVersion),
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
      tenantId: oldParseJob.tenantId,
      bootstrapJobId: oldParseJob.bootstrapJobId,
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
