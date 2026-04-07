import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { WorkerAvailabilityService } from './worker-availability.service';
import { parseRpaFlowDefinitions } from '@uniflow/shared-types';
import { TextGuideLlmParserService } from './text-guide-llm-parser.service';
import {
  buildAuthCredentialPlaceholder,
  detectAuthCredentialFieldKind,
  isAuthCredentialField,
} from '../common/auth-field.util';

type BootstrapAccessMode = 'backend_api' | 'direct_link' | 'text_guide';
type InternalBootstrapMode = 'api_only' | 'rpa_only' | 'hybrid';
type PageSourceType = 'manual' | 'recording' | 'bundle' | 'direct_link' | 'text_guide';

const SSRF_BLOCKED_PATTERNS = [
  /^https?:\/\/169\.254\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/localhost/i,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[fc/i,
  /^https?:\/\/\[fd/i,
  /^https?:\/\/\[fe80:/i,
];

function assertNotInternalUrl(url: string): void {
  for (const pattern of SSRF_BLOCKED_PATTERNS) {
    if (pattern.test(url)) {
      throw new BadRequestException('不允许访问内部网络地址');
    }
  }
}

const BOOTSTRAP_SENSITIVE_AUTH_KEYS = new Set([
  'username',
  'password',
  'token',
  'appSecret',
  'accessToken',
  'refreshToken',
  'secret',
  'serviceToken',
  'ticketHeaderValue',
]);

const ACCESS_MODE_TO_BOOTSTRAP_MODE: Record<BootstrapAccessMode, InternalBootstrapMode> = {
  backend_api: 'api_only',
  direct_link: 'rpa_only',
  text_guide: 'rpa_only',
};

const VALID_RPA_STEP_TYPES = new Set([
  'goto',
  'wait',
  'input',
  'click',
  'select',
  'upload',
  'extract',
  'download',
  'screenshot',
]);

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workerAvailabilityService: WorkerAvailabilityService,
    private readonly textGuideLlmParserService: TextGuideLlmParserService,
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async createJob(dto: CreateBootstrapJobDto) {
    await this.workerAvailabilityService.assertBootstrapWorkerAvailable();

    const tenantId = (dto.tenantId || process.env.DEFAULT_TENANT_ID || '').trim();
    if (!tenantId) {
      throw new BadRequestException('缺少租户标识');
    }
    const now = new Date();
    const accessMode = this.resolveAccessMode({
      accessMode: dto.accessMode,
      bootstrapMode: dto.bootstrapMode,
    });
    const normalizedRpaContent = dto.rpaFlowContent
      ? await this.preparePageAutomationSource(dto.rpaFlowContent, {
          accessMode,
          connectorName: dto.name,
          oaUrl: dto.oaUrl,
          platformConfig: dto.platformConfig,
        })
      : null;
    const hasDeclaredApiSource = Boolean(dto.apiDocContent || dto.apiDocUrl);
    const hasDeclaredRpaSource = Boolean(normalizedRpaContent?.content);

    this.validateAccessModeSelection({
      accessMode,
      hasApiSource: hasDeclaredApiSource,
      hasRpaSource: hasDeclaredRpaSource,
    });

    let apiDocContent = dto.apiDocContent;
    if (dto.apiDocUrl && !apiDocContent) {
      assertNotInternalUrl(dto.apiDocUrl);
      try {
        const response = await axios.get(dto.apiDocUrl, { timeout: 30000 });
        apiDocContent = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
        this.logger.log(`Successfully fetched API doc from ${dto.apiDocUrl}, length: ${apiDocContent.length}`);
      } catch (error: any) {
        this.logger.warn(`Failed to fetch API doc from ${dto.apiDocUrl}: ${error.message}`);
        throw new BadRequestException(`获取接口文档失败: ${error.message}`);
      }
    }

    const bootstrapMode = this.resolveBootstrapMode({
      accessMode,
      bootstrapMode: dto.bootstrapMode as InternalBootstrapMode | undefined,
      hasApiSource: Boolean(apiDocContent || dto.apiDocUrl),
      hasRpaSource: hasDeclaredRpaSource,
    });

    if (!apiDocContent && !dto.oaUrl && !normalizedRpaContent?.content) {
      throw new BadRequestException('请提供接口文档、OA 地址或页面流程内容');
    }

    const normalizedAuthConfig = this.normalizeAuthConfig(dto.authConfig);
    const runtimeConfig = {
      ...(normalizedAuthConfig || {}),
      ...(dto.platformConfig ? { platformConfig: dto.platformConfig } : {}),
      ...(accessMode ? { accessMode } : {}),
      bootstrapMode,
    };
    const authConfig = Object.keys(runtimeConfig).length > 0 || dto.authType
      ? { ...(dto.authType ? { authType: dto.authType } : {}), ...runtimeConfig }
      : null;

    const job = await this.prisma.bootstrapJob.create({
      data: {
        tenantId,
        name: dto.name,
        status: 'CREATED',
        currentStage: 'CREATED',
        stageStartedAt: now,
        lastHeartbeatAt: now,
        oaUrl: dto.oaUrl,
        openApiUrl: dto.apiDocUrl,
        authConfig: authConfig ?? undefined,
      },
    });

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

    if (apiDocContent) {
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: dto.apiDocType || 'openapi',
          sourceContent: apiDocContent,
          metadata: {
            docType: dto.apiDocType || 'openapi',
            docUrl: dto.apiDocUrl,
            accessMode: accessMode || null,
            bootstrapMode,
          },
        },
      });
    }

    if (normalizedRpaContent?.content) {
      const resolvedPageSourceType = this.resolvePageSourceType({
        accessMode,
        explicitSourceType: dto.rpaSourceType,
      });
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: resolvedPageSourceType === 'bundle' ? 'rpa_bundle' : 'manual_rpa',
          sourceContent: normalizedRpaContent.content,
          metadata: {
            sourceType: resolvedPageSourceType,
            accessMode: accessMode || null,
            bootstrapMode,
            platformConfig: dto.platformConfig || null,
            guideText: normalizedRpaContent.guideText || null,
          },
        },
      });
    }

    await this.enqueueBootstrapJob(job.id, 'CREATED');

    const created = await this.prisma.bootstrapJob.findUnique({
      where: { id: job.id },
    });
    return this.sanitizeBootstrapJob(created);
  }

  async getJob(id: string, tenantId: string) {
    const job = await this.prisma.bootstrapJob.findFirst({
      where: { id, tenantId },
      include: {
        sources: true,
        reports: true,
        flowIRs: true,
        fieldIRs: true,
        ruleIRs: true,
        permissionIRs: true,
        adapterBuilds: true,
        repairAttempts: {
          orderBy: [
            { flowCode: 'asc' },
            { attemptNo: 'desc' },
          ],
        },
        replayCases: {
          include: {
            replayResults: true,
          },
        },
      },
    });
    return this.sanitizeBootstrapJob(job);
  }

  async listJobs(tenantId: string) {
    const jobs = await this.prisma.bootstrapJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        reports: true,
      },
    });
    return jobs.map((job) => this.sanitizeBootstrapJob(job));
  }

  async getReport(jobId: string, tenantId: string) {
    return this.prisma.bootstrapReport.findFirst({
      where: {
        bootstrapJobId: jobId,
        bootstrapJob: {
          tenantId,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reactivate(
    jobId: string,
    tenantId: string,
    mode: 'reuse' | 'new',
    newDoc?: {
      apiDocContent?: string;
      apiDocUrl?: string;
      apiDocType?: string;
      rpaFlowContent?: string;
      rpaSourceType?: string;
      platformConfig?: Record<string, any>;
      accessMode?: BootstrapAccessMode;
      bootstrapMode?: InternalBootstrapMode;
      oaUrl?: string;
      authConfig?: Record<string, any>;
    },
  ) {
    const job = await this.prisma.bootstrapJob.findFirst({
      where: { id: jobId, tenantId },
      include: { sources: true },
    });

    if (!job) throw new NotFoundException('初始化任务不存在');

    if (job.connectorId && job.status === 'PUBLISHED') {
      throw new BadRequestException('当前初始化任务绑定的连接器仍然存在，无需重新激活');
    }

    let docUrlToPersist = job.openApiUrl;
    const existingAuthConfig = ((job.authConfig as Record<string, any> | null) || {});
    const currentAccessMode = this.resolveAccessMode({
      accessMode: existingAuthConfig.accessMode,
      bootstrapMode: existingAuthConfig.bootstrapMode,
    });
    const requestedAccessMode = this.resolveAccessMode({
      accessMode: newDoc?.accessMode,
      bootstrapMode: newDoc?.bootstrapMode,
      currentAccessMode,
      currentBootstrapMode: existingAuthConfig.bootstrapMode,
    });
    const reusableHasApiSource = this.hasHistoricalApiSource(job.sources || []) || Boolean(job.openApiUrl);
    const reusableHasRpaSource = this.hasHistoricalRpaSource(job.sources || []);
    const normalizedRpaContent = newDoc?.rpaFlowContent
      ? await this.preparePageAutomationSource(newDoc.rpaFlowContent, {
          accessMode: requestedAccessMode,
          connectorName: job.name || newDoc?.oaUrl || 'Page flow',
          oaUrl: newDoc?.oaUrl || job.oaUrl || undefined,
          platformConfig: newDoc?.platformConfig,
        })
      : null;
    let nextBootstrapMode = this.resolveBootstrapMode({
      accessMode: requestedAccessMode,
      bootstrapMode: newDoc?.bootstrapMode,
      hasApiSource: mode === 'reuse'
        ? reusableHasApiSource
        : Boolean(newDoc?.apiDocContent || newDoc?.apiDocUrl),
      hasRpaSource: mode === 'reuse'
        ? reusableHasRpaSource
        : Boolean(normalizedRpaContent?.content),
      currentBootstrapMode: existingAuthConfig.bootstrapMode,
    });

    if (mode === 'reuse') {
      this.validateAccessModeSelection({
        accessMode: requestedAccessMode,
        hasApiSource: reusableHasApiSource,
        hasRpaSource: reusableHasRpaSource,
      });
    }

    if (mode === 'new') {
      let docContent = newDoc?.apiDocContent;
      if (!docContent && newDoc?.apiDocUrl) {
        assertNotInternalUrl(newDoc.apiDocUrl);
        try {
          const response = await axios.get(newDoc.apiDocUrl, { timeout: 30000 });
          docContent = typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data);
        } catch (error: any) {
          throw new BadRequestException(`获取接口文档失败: ${error.message}`);
        }
      }
      this.validateAccessModeSelection({
        accessMode: requestedAccessMode,
        hasApiSource: Boolean(docContent || newDoc?.apiDocUrl),
        hasRpaSource: Boolean(normalizedRpaContent?.content),
      });
      nextBootstrapMode = this.resolveBootstrapMode({
        accessMode: requestedAccessMode,
        bootstrapMode: newDoc?.bootstrapMode,
        hasApiSource: Boolean(docContent || newDoc?.apiDocUrl),
        hasRpaSource: Boolean(normalizedRpaContent?.content),
        currentBootstrapMode: existingAuthConfig.bootstrapMode,
      });

      if (!docContent && !normalizedRpaContent?.content) {
        throw new BadRequestException('请提供新的接口文档内容、接口文档链接或页面流程内容');
      }

      if (docContent) {
        docUrlToPersist = newDoc?.apiDocUrl || job.openApiUrl;

        await this.prisma.bootstrapSource.create({
          data: {
            bootstrapJobId: jobId,
            sourceType: newDoc?.apiDocType || 'openapi',
            sourceContent: docContent,
            metadata: {
              docType: newDoc?.apiDocType || 'openapi',
              docUrl: newDoc?.apiDocUrl,
              accessMode: requestedAccessMode || null,
              bootstrapMode: nextBootstrapMode,
              reactivatedAt: new Date().toISOString(),
            },
          },
        });
      } else if (nextBootstrapMode === 'rpa_only') {
        docUrlToPersist = null;
      }

      if (normalizedRpaContent?.content) {
        const resolvedPageSourceType = this.resolvePageSourceType({
          accessMode: requestedAccessMode,
          explicitSourceType: newDoc.rpaSourceType,
        });
        await this.prisma.bootstrapSource.create({
          data: {
            bootstrapJobId: jobId,
            sourceType: resolvedPageSourceType === 'bundle' ? 'rpa_bundle' : 'manual_rpa',
            sourceContent: normalizedRpaContent.content,
            metadata: {
              sourceType: resolvedPageSourceType,
              accessMode: requestedAccessMode || null,
              bootstrapMode: nextBootstrapMode,
              platformConfig: newDoc.platformConfig || null,
              guideText: normalizedRpaContent.guideText || null,
              reactivatedAt: new Date().toISOString(),
            },
          },
        });
      }
    } else {
      const latestSource = job.sources
        .filter((s) => s.sourceContent)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (!latestSource?.sourceContent) {
        throw new BadRequestException('没有可复用的历史初始化材料，请上传新的内容');
      }
    }

    if (nextBootstrapMode === 'rpa_only') {
      docUrlToPersist = null;
    }

    const normalizedAuthConfig = newDoc?.authConfig !== undefined
      ? this.normalizeAuthConfig(newDoc.authConfig)
      : existingAuthConfig;
    const nextAuthConfig = this.mergeRuntimeConfig(
      normalizedAuthConfig,
      newDoc?.platformConfig,
      nextBootstrapMode,
      requestedAccessMode,
    );

    await this.prisma.bootstrapRepairAttempt.deleteMany({
      where: { bootstrapJobId: jobId },
    });

    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        status: 'CREATED',
        currentStage: 'CREATED',
        queueJobId: null,
        stageStartedAt: new Date(),
        lastHeartbeatAt: new Date(),
        stalledReason: null,
        lastError: null,
        recoveryAttemptCount: 0,
        reconcileAttemptCount: 0,
        completedAt: null,
        connectorId: null,
        oaUrl: newDoc?.oaUrl || job.oaUrl,
        openApiUrl: docUrlToPersist,
        authConfig: nextAuthConfig as any,
      },
    });

    await this.enqueueBootstrapJob(jobId, 'CREATED');

    return { jobId, mode, status: 'CREATED' };
  }

  private normalizeAuthConfig(authConfig?: Record<string, any> | null) {
    if (authConfig === undefined) {
      return undefined;
    }
    if (!authConfig) {
      return null;
    }

    const normalized = Object.fromEntries(
      Object.entries(authConfig).filter(([key, value]) => !key.startsWith('_') && value !== ''),
    );

    return Object.keys(normalized).length > 0 ? normalized : {};
  }

  private mergeRuntimeConfig(
    normalizedAuthConfig: Record<string, any> | null | undefined,
    platformConfig: Record<string, any> | undefined,
    bootstrapMode: InternalBootstrapMode,
    accessMode?: BootstrapAccessMode,
  ) {
    const baseConfig = normalizedAuthConfig === undefined
      ? undefined
      : (normalizedAuthConfig || {});
    const runtimeConfig = {
      ...(baseConfig || {}),
      ...(platformConfig ? { platformConfig } : {}),
      ...(accessMode ? { accessMode } : {}),
      bootstrapMode,
    };

    return Object.keys(runtimeConfig).length > 0 ? runtimeConfig : null;
  }

  private async preparePageAutomationSource(
    rpaFlowContent: string,
    input: {
      accessMode?: BootstrapAccessMode;
      connectorName?: string;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ): Promise<{ content: string; guideText?: string }> {
    const definitions = parseRpaFlowDefinitions(rpaFlowContent);
    if (definitions.length > 0) {
      return { content: rpaFlowContent };
    }

    if (input.accessMode !== 'text_guide') {
      throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
    }

    const generated = (await this.tryBuildTextGuideFlowBundleWithLlm(rpaFlowContent, input))
      || this.buildTextGuideFlowBundleFromDescription(rpaFlowContent, {
        connectorName: input.connectorName,
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });
    this.validateGeneratedTextGuideFlowBundle(generated);
    return {
      content: JSON.stringify(generated),
      guideText: rpaFlowContent,
    };
  }

  private resolveBootstrapMode(input: {
    accessMode?: BootstrapAccessMode;
    bootstrapMode?: InternalBootstrapMode;
    hasApiSource: boolean;
    hasRpaSource: boolean;
    currentBootstrapMode?: unknown;
  }): InternalBootstrapMode {
    if (input.accessMode) {
      return ACCESS_MODE_TO_BOOTSTRAP_MODE[input.accessMode];
    }

    if (input.bootstrapMode) {
      if (input.bootstrapMode === 'hybrid' && !input.hasRpaSource) {
        throw new BadRequestException('混合模式必须提供页面流程内容');
      }
      if (input.bootstrapMode === 'rpa_only' && !input.hasRpaSource) {
        throw new BadRequestException('页面流程模式必须提供页面流程内容');
      }
      return input.bootstrapMode;
    }

    if (input.hasApiSource && input.hasRpaSource) return 'hybrid';
    if (input.hasRpaSource) return 'rpa_only';
    if (input.hasApiSource) return 'api_only';
    if (input.currentBootstrapMode === 'api_only' || input.currentBootstrapMode === 'rpa_only' || input.currentBootstrapMode === 'hybrid') {
      return input.currentBootstrapMode;
    }
    return 'api_only';
  }

  private resolveAccessMode(input: {
    accessMode?: unknown;
    bootstrapMode?: unknown;
    currentAccessMode?: BootstrapAccessMode;
    currentBootstrapMode?: unknown;
  }): BootstrapAccessMode | undefined {
    const normalized = String(input.accessMode || '').trim().toLowerCase();
    if (normalized === 'backend_api' || normalized === 'direct_link' || normalized === 'text_guide') {
      return normalized;
    }

    const bootstrapMode = String(input.bootstrapMode || '').trim().toLowerCase();
    if (bootstrapMode === 'api_only') return 'backend_api';
    if (bootstrapMode === 'rpa_only') return 'direct_link';

    if (input.currentAccessMode) {
      return input.currentAccessMode;
    }

    const currentBootstrapMode = String(input.currentBootstrapMode || '').trim().toLowerCase();
    if (currentBootstrapMode === 'api_only') return 'backend_api';
    if (currentBootstrapMode === 'rpa_only') return 'direct_link';
    return undefined;
  }

  private validateAccessModeSelection(input: {
    accessMode?: BootstrapAccessMode;
    hasApiSource: boolean;
    hasRpaSource: boolean;
  }) {
    if (!input.accessMode) {
      return;
    }

    if (input.accessMode === 'backend_api') {
      if (!input.hasApiSource) {
        throw new BadRequestException('接口接入必须提供接口文档或接口文档链接');
      }
      if (input.hasRpaSource) {
        throw new BadRequestException('接口接入不需要填写页面流程内容');
      }
      return;
    }

    if (!input.hasRpaSource) {
      throw new BadRequestException(
        input.accessMode === 'text_guide'
          ? '文字示教接入必须填写操作步骤说明'
          : '链接直达接入必须提供页面流程内容',
      );
    }

    if (input.hasApiSource) {
      throw new BadRequestException(
        input.accessMode === 'text_guide'
          ? '文字示教接入不需要接口文档'
          : '链接直达接入不需要接口文档',
      );
    }
  }

  private resolvePageSourceType(input: {
    accessMode?: BootstrapAccessMode;
    explicitSourceType?: string;
  }): PageSourceType {
    const explicit = String(input.explicitSourceType || '').trim().toLowerCase();
    if (
      explicit === 'manual'
      || explicit === 'recording'
      || explicit === 'bundle'
      || explicit === 'direct_link'
      || explicit === 'text_guide'
    ) {
      return explicit as PageSourceType;
    }

    if (input.accessMode === 'text_guide') {
      return 'text_guide';
    }

    if (input.accessMode === 'direct_link') {
      return 'direct_link';
    }

    return 'manual';
  }

  private hasHistoricalApiSource(sources: Array<{ sourceType?: string | null; sourceContent?: string | null; sourceUrl?: string | null }>) {
    return sources.some((source) =>
      ['openapi', 'swagger', 'custom'].includes(source.sourceType || '')
      && Boolean(source.sourceContent || source.sourceUrl),
    );
  }

  private hasHistoricalRpaSource(sources: Array<{ sourceType?: string | null }>) {
    return sources.some((source) => ['manual_rpa', 'rpa_bundle'].includes(source.sourceType || ''));
  }

  private buildTextGuideFlowBundle(
    guideText: string,
    input: {
      connectorName?: string;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    const lines = guideText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.replace(/^[-*]\s*/, ''))
      .map((line) => line.replace(/^\d+[.)、]\s*/, ''))
      .filter(Boolean);

    if (lines.length === 0) {
      throw new BadRequestException('Text-guide access requires a non-empty flow description');
    }

    const entryUrl = String(input.platformConfig?.entryUrl || input.oaUrl || '').trim();
    const processName = (input.connectorName || 'Text Guided Flow').trim();
    const processCode = this.toProcessCode(processName);
    const steps: Array<Record<string, any>> = [];
    const fields: Array<Record<string, any>> = [];
    let successText: string | undefined;

    if (entryUrl) {
      steps.push({
        type: 'goto',
        value: entryUrl,
        description: 'Open the configured entry page',
      });
    }

    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/\S+/i);
      if (urlMatch) {
        steps.push({
          type: 'goto',
          value: urlMatch[0],
          description: line,
        });
        continue;
      }

      const waitMatch = line.match(/等待\s*(\d+)\s*(秒|毫秒|ms)?/);
      if (waitMatch) {
        const amount = Number(waitMatch[1]);
        const unit = waitMatch[2];
        steps.push({
          type: 'wait',
          timeoutMs: unit === '秒' ? amount * 1000 : amount,
          description: line,
        });
        continue;
      }

      const inputMatch = line.match(/^(输入|填写|填入|录入)\s*(.+?)(?:为|是|[:：])?\s*[“"']?(.+?)?[”"']?$/);
      if (inputMatch) {
        const label = this.normalizeGuideLabel(inputMatch[2]);
        const value = inputMatch[3]?.trim() || undefined;
        const authKind = detectAuthCredentialFieldKind({ label })
          || (/^(用户名|用户账号|登录账号|登录用户名|登录工号|username|login name|login id)$/i.test(label)
            ? 'username'
            : null);
        const fieldKey = authKind ? undefined : this.toFieldKey(label, fields.length + 1);
        if (!authKind && fieldKey) {
          fields.push({
            key: fieldKey,
            label,
            type: this.inferFieldType(label, value),
            required: true,
          });
        }
        steps.push({
          type: 'input',
          fieldKey,
          value: authKind ? buildAuthCredentialPlaceholder(authKind) : value,
          target: {
            kind: 'text',
            value: label,
            label,
          },
          description: line,
        });
        continue;
      }

      const uploadMatch = line.match(/^上传\s*(.+)$/);
      if (uploadMatch) {
        const label = this.normalizeGuideLabel(uploadMatch[1]);
        const fieldKey = this.toFieldKey(label, fields.length + 1);
        fields.push({
          key: fieldKey,
          label,
          type: 'file',
          required: true,
        });
        steps.push({
          type: 'upload',
          fieldKey,
          target: {
            kind: 'text',
            value: label,
            label,
          },
          description: line,
        });
        continue;
      }

      const successMatch = line.match(/^看到\s*[“"']?(.+?)[”"']?(?:就结束|说明成功|即成功)?$/);
      if (successMatch) {
        successText = successMatch[1]?.trim() || successText;
        continue;
      }

      const clickMatch = line.match(/^(点击|单击|选择|打开|进入|提交)\s*(.+)$/);
      if (clickMatch) {
        const label = this.normalizeGuideLabel(clickMatch[2]);
        steps.push({
          type: 'click',
          target: {
            kind: 'text',
            value: label,
            label,
          },
          description: line,
        });
        continue;
      }

      steps.push({
        type: 'click',
        target: {
          kind: 'text',
          value: this.normalizeGuideLabel(line),
          label: this.normalizeGuideLabel(line),
        },
        description: line,
      });
    }

    if (steps.length === 0) {
      throw new BadRequestException('No executable steps were detected from the text guide');
    }

    return {
      flows: [{
        processCode,
        processName,
        description: 'Generated from a text-guided page flow description',
        fields,
        actions: {
          submit: {
            steps,
            ...(successText
              ? {
                  successAssert: {
                    type: 'text',
                    value: successText,
                  },
                }
              : {}),
          },
        },
        platform: {
          ...(entryUrl ? { entryUrl } : {}),
          ...(input.platformConfig?.targetSystem ? { targetSystem: input.platformConfig.targetSystem } : {}),
          ...(input.platformConfig?.jumpUrlTemplate ? { jumpUrlTemplate: input.platformConfig.jumpUrlTemplate } : {}),
          ...(input.platformConfig?.ticketBrokerUrl ? { ticketBrokerUrl: input.platformConfig.ticketBrokerUrl } : {}),
        },
        runtime: {
          executorMode: this.normalizeExecutorModeValue(input.platformConfig?.executorMode) || 'browser',
          browserProvider: 'playwright',
          headless: false,
          snapshotMode: 'structured-text',
        },
      }],
    };
  }

  private normalizeGuideLabel(value: string) {
    return value
      .replace(/[“”"'']/g, '')
      .replace(/(按钮|菜单|链接|页面|页签|输入框|字段)$/u, '')
      .trim();
  }

  private inferFieldType(label: string, sampleValue?: string) {
    const text = `${label} ${sampleValue || ''}`.toLowerCase();
    if (text.includes('日期') || /\d{4}-\d{1,2}-\d{1,2}/.test(text)) return 'date';
    if (text.includes('附件') || text.includes('文件')) return 'file';
    if (text.includes('原因') || text.includes('说明') || text.includes('备注')) return 'textarea';
    return 'text';
  }

  private toFieldKey(label: string, index: number) {
    const ascii = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return ascii || `field_${index}`;
  }

  private toProcessCode(name: string) {
    const ascii = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return ascii || 'text_guided_flow';
  }

  private buildTextGuideFlowBundleFromDescription(
    guideText: string,
    input: {
      connectorName?: string;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    const parsedDocument = this.parseStructuredTextGuideDocument(guideText);
    if (!parsedDocument) {
      return {
        flows: [this.buildTextGuideFlowFromStepLines({
          processName: (input.connectorName || '文字示教流程').trim() || '文字示教流程',
          stepSource: guideText,
          oaUrl: input.oaUrl,
          platformConfig: input.platformConfig,
        })],
      };
    }

    const defaultProcessName = (input.connectorName || '文字示教流程').trim() || '文字示教流程';
    const basePlatformConfig = {
      ...(input.platformConfig || {}),
      ...(parsedDocument.platformConfig || {}),
    };

    return {
      flows: parsedDocument.flows.map((flow, index) => this.buildTextGuideFlowFromStepLines({
        processName: flow.processName || `${defaultProcessName}_${index + 1}`,
        processCode: this.normalizeProcessCode(flow.processCode),
        stepSource: [...parsedDocument.sharedSteps, ...flow.steps],
        fieldDefinitions: flow.fields,
        testData: flow.testData,
        oaUrl: input.oaUrl,
        platformConfig: {
          ...basePlatformConfig,
          ...(flow.platformConfig || {}),
        },
      })),
    };
  }

  private async tryBuildTextGuideFlowBundleWithLlm(
    guideText: string,
    input: {
      connectorName?: string;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    try {
      const parsedDocument = await this.textGuideLlmParserService.parse({
        guideText,
        connectorName: input.connectorName,
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });

      if (!parsedDocument) {
        return null;
      }

      const defaultProcessName = (input.connectorName || 'Text Guided Flow').trim() || 'Text Guided Flow';
      const basePlatformConfig = {
        ...(input.platformConfig || {}),
        ...(parsedDocument.platformConfig || {}),
      };

      return {
        flows: parsedDocument.flows.map((flow, index) => this.buildTextGuideFlowFromStepLines({
          processName: flow.processName || `${defaultProcessName}_${index + 1}`,
          processCode: this.normalizeProcessCode(flow.processCode),
          stepSource: [...parsedDocument.sharedSteps, ...flow.steps],
          fieldDefinitions: flow.fields,
          testData: flow.testData,
          oaUrl: input.oaUrl,
          platformConfig: {
            ...basePlatformConfig,
            ...(flow.platformConfig || {}),
          },
        })),
      };
    } catch (error: any) {
      this.logger.warn(`LLM text-guide parser failed, fallback to rules: ${error.message}`);
      return null;
    }
  }

  private validateGeneratedTextGuideFlowBundle(bundle: { flows?: Array<Record<string, any>> }) {
    const definitions = parseRpaFlowDefinitions(bundle);
    if (definitions.length === 0 || !Array.isArray(bundle.flows) || bundle.flows.length === 0) {
      throw new BadRequestException('Invalid text-guide output: no executable steps');
    }

    for (const flow of bundle.flows) {
      const submitSteps = flow?.actions?.submit?.steps;
      if (!Array.isArray(submitSteps) || submitSteps.length === 0) {
        throw new BadRequestException('Invalid text-guide output: no executable steps');
      }

      const invalidStep = submitSteps.find(
        (step) => !VALID_RPA_STEP_TYPES.has(String(step?.type || '')),
      );
      if (invalidStep) {
        throw new BadRequestException('Invalid text-guide output: unsupported step type');
      }
    }
  }

  private buildTextGuideFlowFromStepLines(input: {
    processName: string;
    processCode?: string;
    stepSource: string | string[];
    fieldDefinitions?: Array<{
      label?: string;
      fieldKey?: string;
      type?: string;
      required?: boolean;
    }>;
    testData?: Record<string, any>;
    oaUrl?: string;
    platformConfig?: Record<string, any>;
  }) {
    const lines = this.normalizeGuideStepLines(input.stepSource);
    if (lines.length === 0) {
      throw new BadRequestException('文字示教接入必须填写非空步骤说明');
    }

    const entryUrl = String(input.platformConfig?.entryUrl || input.oaUrl || '').trim();
    const processName = input.processName.trim() || '文字示教流程';
    const processCode = this.normalizeProcessCode(input.processCode) || this.toProcessCode(processName);
    const steps: Array<Record<string, any>> = [];
    const fields: Array<Record<string, any>> = [];
    const fieldKeyByLabel = new Map<string, string>();
    let successText: string | undefined;
    const normalizedTestData = this.hydrateGuideFieldDefinitions({
      fields,
      fieldKeyByLabel,
      fieldDefinitions: input.fieldDefinitions,
      testData: input.testData,
    });

    if (entryUrl) {
      steps.push({
        type: 'goto',
        value: entryUrl,
        description: '打开入口页面',
      });
    }

    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/\S+/i);
      if (urlMatch) {
        steps.push({
          type: 'goto',
          value: urlMatch[0],
          description: line,
        });
        continue;
      }

      const waitMatch = line.match(/^(?:等待|停留)\s*(\d+)\s*(秒|毫秒|ms)?$/u);
      if (waitMatch) {
        const amount = Number(waitMatch[1]);
        const unit = (waitMatch[2] || '秒').toLowerCase();
        steps.push({
          type: 'wait',
          timeoutMs: unit === '毫秒' || unit === 'ms' ? amount : amount * 1000,
          description: line,
        });
        continue;
      }

      const inputMatch = this.parseGuideInstructionV2(line, ['输入', '填写', '填入', '录入']);
      if (inputMatch) {
        const authKind = detectAuthCredentialFieldKind({ label: inputMatch.label })
          || (/^(用户名|用户账号|登录账号|登录用户名|登录工号|username|login name|login id)$/i.test(inputMatch.label)
            ? 'username'
            : null);
        const fieldKey = authKind
          ? undefined
          : this.ensureGuideField(
              fields,
              fieldKeyByLabel,
              inputMatch.label,
              this.inferFieldTypeV2(inputMatch.label, inputMatch.value),
            );
        steps.push({
          type: 'input',
          fieldKey,
          value: authKind ? buildAuthCredentialPlaceholder(authKind) : inputMatch.value,
          target: {
            kind: 'text',
            value: inputMatch.label,
            label: inputMatch.label,
          },
          description: line,
        });
        continue;
      }

      const selectMatch = this.parseGuideInstructionV2(line, ['选择', '选中']);
      if (selectMatch) {
        if (!selectMatch.value) {
          steps.push({
            type: 'click',
            target: {
              kind: 'text',
              value: selectMatch.label,
              label: selectMatch.label,
            },
            description: line,
          });
          continue;
        }

        const authKind = detectAuthCredentialFieldKind({ label: selectMatch.label })
          || (/^(用户名|用户账号|登录账号|登录用户名|登录工号|username|login name|login id)$/i.test(selectMatch.label)
            ? 'username'
            : null);
        const fieldKey = authKind
          ? undefined
          : this.ensureGuideField(fields, fieldKeyByLabel, selectMatch.label, 'select');
        steps.push({
          type: 'select',
          fieldKey,
          value: authKind ? buildAuthCredentialPlaceholder(authKind) : selectMatch.value,
          target: {
            kind: 'text',
            value: selectMatch.label,
            label: selectMatch.label,
          },
          description: line,
        });
        continue;
      }

      const uploadMatch = line.match(/^(?:上传|附加|添加附件)\s+(.+)$/u);
      if (uploadMatch) {
        const label = this.normalizeGuideLabelV2(uploadMatch[1]);
        const fieldKey = this.ensureGuideField(fields, fieldKeyByLabel, label, 'file');
        steps.push({
          type: 'upload',
          fieldKey,
          target: {
            kind: 'text',
            value: label,
            label,
          },
          description: line,
        });
        continue;
      }

      const successMatch = line.match(/^(?:看到|出现|显示)\s+["“]?(.+?)["”]?(?:\s*(?:就|即|则)?(?:结束|成功|完成))?$/u);
      if (successMatch) {
        successText = successMatch[1]?.trim() || successText;
        continue;
      }

      const clickTarget = this.parseGuideClickInstructionV2(line);
      if (clickTarget) {
        steps.push({
          type: 'click',
          target: {
            kind: 'text',
            value: clickTarget,
            label: clickTarget,
          },
          description: line,
        });
        continue;
      }

      const label = this.normalizeGuideLabelV2(line);
      steps.push({
        type: 'click',
        target: {
          kind: 'text',
          value: label,
          label,
        },
        description: line,
      });
    }

    if (steps.length === 0) {
      throw new BadRequestException('未从步骤说明中识别出可执行动作');
    }

    return {
      processCode,
      processName,
      description: '根据文字示教自动生成的页面流程',
      fields,
      ...(Object.keys(normalizedTestData).length > 0
        ? {
            metadata: {
              textGuide: {
                sampleData: normalizedTestData,
              },
            },
          }
        : {}),
      actions: {
        submit: {
          steps,
          ...(successText
            ? {
                successAssert: {
                  type: 'text',
                  value: successText,
                },
              }
            : {}),
        },
      },
      platform: {
        ...(entryUrl ? { entryUrl } : {}),
        ...(input.platformConfig?.targetSystem ? { targetSystem: input.platformConfig.targetSystem } : {}),
        ...(input.platformConfig?.jumpUrlTemplate ? { jumpUrlTemplate: input.platformConfig.jumpUrlTemplate } : {}),
        ...(input.platformConfig?.ticketBrokerUrl ? { ticketBrokerUrl: input.platformConfig.ticketBrokerUrl } : {}),
      },
      runtime: {
        executorMode: this.normalizeExecutorModeValue(input.platformConfig?.executorMode) || 'browser',
        browserProvider: 'playwright',
        headless: false,
        snapshotMode: 'structured-text',
      },
    };
  }

  private normalizeGuideStepLines(stepSource: string | string[]) {
    const sourceLines = Array.isArray(stepSource) ? stepSource : stepSource.split(/\r?\n+/);
    return sourceLines
      .flatMap((line) => String(line || '').split(/[；;]+/))
      .map((line) => line.trim())
      .map((line) => line.replace(/^[-*•]\s*/, ''))
      .map((line) => line.replace(/^\d+[.)、]\s*/, ''))
      .map((line) => this.stripGuideLeadWordsV2(line))
      .filter(Boolean);
  }

  private parseStructuredTextGuideDocument(guideText: string) {
    const rawLines = guideText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const hasFlowHeader = rawLines.some((line) => Boolean(this.parseGuideFlowHeader(line)));
    if (!hasFlowHeader) {
      return null;
    }

    const sharedSteps: string[] = [];
    const platformConfig: Record<string, any> = {};
    const flows: Array<{
      processName: string;
      processCode?: string;
      steps: string[];
      fields: Array<{
        label: string;
        fieldKey?: string;
        type?: string;
        required?: boolean;
      }>;
      testData: Record<string, string>;
      platformConfig: Record<string, any>;
    }> = [];

    let currentSection:
      | 'preamble'
      | 'global'
      | 'shared'
      | 'flow_steps'
      | 'flow_fields'
      | 'flow_examples' = 'preamble';
    let currentFlow: {
      processName: string;
      processCode?: string;
      steps: string[];
      fields: Array<{
        label: string;
        fieldKey?: string;
        type?: string;
        required?: boolean;
      }>;
      testData: Record<string, string>;
      platformConfig: Record<string, any>;
    } | null = null;

    const flushCurrentFlow = () => {
      if (!currentFlow) {
        return;
      }
      flows.push(currentFlow);
      currentFlow = null;
    };

    for (const line of rawLines) {
      if (this.isGuideGlobalSectionHeader(line)) {
        flushCurrentFlow();
        currentSection = 'global';
        continue;
      }

      if (this.isGuideSharedStepsSectionHeader(line)) {
        flushCurrentFlow();
        currentSection = 'shared';
        continue;
      }

      const flowHeader = this.parseGuideFlowHeader(line);
      if (flowHeader) {
        flushCurrentFlow();
        currentSection = 'flow_steps';
        currentFlow = {
          processName: flowHeader.processName,
          steps: [],
          fields: [],
          testData: {},
          platformConfig: {},
        };
        continue;
      }

      if (/^(?:步骤|步骤列表)\s*[:：]?$/u.test(line)) {
        if (currentFlow) {
          currentSection = 'flow_steps';
        }
        continue;
      }

      if (this.isGuideFieldSectionHeader(line)) {
        if (currentFlow) {
          currentSection = 'flow_fields';
        }
        continue;
      }

      if (this.isGuideTestDataSectionHeader(line)) {
        if (currentFlow) {
          currentSection = 'flow_examples';
        }
        continue;
      }

      if (
        (currentSection === 'flow_steps'
          || currentSection === 'flow_fields'
          || currentSection === 'flow_examples')
        && currentFlow
      ) {
        const explicitProcessCode = this.parseGuideProcessCodeLine(line);
        if (explicitProcessCode) {
          currentFlow.processCode = explicitProcessCode;
          continue;
        }

        if (this.tryAssignGuidePlatformConfig(currentFlow.platformConfig, line)) {
          continue;
        }

        if (currentSection === 'flow_fields') {
          const fieldDefinition = this.parseGuideFieldDefinitionLine(line);
          if (fieldDefinition) {
            currentFlow.fields.push(fieldDefinition);
          }
          continue;
        }

        if (currentSection === 'flow_examples') {
          const testDataEntry = this.parseGuideTestDataLine(line);
          if (testDataEntry) {
            currentFlow.testData[testDataEntry.label] = testDataEntry.value;
          }
          continue;
        }

        currentFlow.steps.push(line);
        continue;
      }

      if (this.tryAssignGuidePlatformConfig(platformConfig, line)) {
        continue;
      }

      sharedSteps.push(line);
    }

    flushCurrentFlow();

    if (flows.length === 0) {
      return null;
    }

    return {
      sharedSteps,
      platformConfig,
      flows,
    };
  }

  private isGuideFieldSectionHeader(line: string) {
    return /^(?:#{1,6}\s*)?(?:参数|字段)(?:定义)?\s*[:：]?$/u.test(line);
  }

  private isGuideTestDataSectionHeader(line: string) {
    return /^(?:#{1,6}\s*)?(?:测试样例|测试数据|样例|示例数据)\s*[:：]?$/u.test(line);
  }

  private isGuideGlobalSectionHeader(line: string) {
    return /^(?:#{1,6}\s*)?全局(?:配置)?\s*[:：]?$/u.test(line);
  }

  private isGuideSharedStepsSectionHeader(line: string) {
    return /^(?:#{1,6}\s*)?(?:共享步骤|公共步骤|通用步骤)\s*[:：]?$/u.test(line);
  }

  private parseGuideFlowHeader(line: string) {
    const match = line.match(/^(?:#{1,6}\s*)?流程\s*(?:[:：]\s*|\s+)(.+)$/u);
    if (!match) {
      return null;
    }

    const normalizedName = match[1]
      .replace(/["“”'‘’]/gu, '')
      .trim();

    if (!normalizedName) {
      return null;
    }

    return {
      processName: normalizedName,
    };
  }

  private parseGuideProcessCodeLine(line: string) {
    const match = line.match(/^(?:流程编码|processCode)\s*[:：]\s*(.+)$/iu);
    if (!match) {
      return null;
    }

    return this.normalizeProcessCode(match[1]) || null;
  }

  private normalizeProcessCode(value?: string) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || undefined;
  }

  private parseGuideFieldDefinitionLine(line: string) {
    const normalizedLine = this.normalizeGuideStructuredLine(line);
    if (!normalizedLine) {
      return null;
    }

    const pipeSegments = normalizedLine
      .split('|')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (normalizedLine.includes('|')) {
      const label = this.normalizeGuideLabelV2(pipeSegments[0]);
      if (!label) {
        return null;
      }

      const type = pipeSegments
        .map((segment) => this.normalizeGuideFieldTypeValue(segment))
        .find(Boolean);
      const required = this.parseGuideRequiredFlag(pipeSegments);

      return {
        label,
        ...(type ? { type } : {}),
        ...(required !== undefined ? { required } : {}),
      };
    }

    const assignmentMatch = normalizedLine.match(/^(.+?)(?:\s*[:：]\s*)(.+)$/u);
    if (assignmentMatch) {
      const label = this.normalizeGuideLabelV2(assignmentMatch[1]);
      const tokens = assignmentMatch[2]
        .split(/[|,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (!label) {
        return null;
      }

      const type = tokens
        .map((token) => this.normalizeGuideFieldTypeValue(token))
        .find(Boolean);
      const required = this.parseGuideRequiredFlag(tokens);

      return {
        label,
        ...(type ? { type } : {}),
        ...(required !== undefined ? { required } : {}),
      };
    }

    const label = this.normalizeGuideLabelV2(normalizedLine);
    if (!label) {
      return null;
    }

    return { label };
  }

  private parseGuideTestDataLine(line: string) {
    const normalizedLine = this.normalizeGuideStructuredLine(line);
    if (!normalizedLine) {
      return null;
    }

    const assignmentMatch = normalizedLine.match(/^(.+?)(?:\s*(?:为|[:：=])\s*)(.+)$/u);
    if (!assignmentMatch) {
      return null;
    }

    const label = this.normalizeGuideLabelV2(assignmentMatch[1]);
    const value = assignmentMatch[2]
      ?.trim()
      ?.replace(/["“”'‘’]/gu, '');

    if (!label || !value) {
      return null;
    }

    return { label, value };
  }

  private normalizeGuideStructuredLine(line: string) {
    return String(line || '')
      .trim()
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim();
  }

  private parseGuideRequiredFlag(tokens: string[]) {
    const normalizedTokens = tokens.map((token) => token.trim().toLowerCase());
    if (normalizedTokens.some((token) => token === '必填' || token === 'required')) {
      return true;
    }

    if (normalizedTokens.some((token) => token === '选填' || token === 'optional' || token === '可选')) {
      return false;
    }

    return undefined;
  }

  private normalizeGuideFieldTypeValue(value?: string) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (['text', '文本', '字符串', '单行文本'].includes(normalized)) return 'text';
    if (['textarea', '多行文本', '备注', '说明'].includes(normalized)) return 'textarea';
    if (['date', '日期', '时间', 'datetime'].includes(normalized)) return 'date';
    if (['select', '下拉', '枚举', '选项'].includes(normalized)) return 'select';
    if (['file', '附件', '文件', 'upload'].includes(normalized)) return 'file';
    if (['number', '数字', '金额', '整数', '小数'].includes(normalized)) return 'number';
    return undefined;
  }

  private hydrateGuideFieldDefinitions(input: {
    fields: Array<Record<string, any>>;
    fieldKeyByLabel: Map<string, string>;
    fieldDefinitions?: Array<{
      label?: string;
      fieldKey?: string;
      type?: string;
      required?: boolean;
    }>;
    testData?: Record<string, any>;
  }) {
    const normalizedTestData: Record<string, string> = {};
    const fieldDefinitions = Array.isArray(input.fieldDefinitions) ? input.fieldDefinitions : [];
    const rawTestData = input.testData && typeof input.testData === 'object' ? input.testData : {};

    for (const definition of fieldDefinitions) {
      const label = this.normalizeGuideLabelV2(definition.label);
      if (!label) {
        continue;
      }
      if (isAuthCredentialField({ label, key: definition.fieldKey })) {
        continue;
      }

      const sampleValue = rawTestData[label] === undefined ? undefined : String(rawTestData[label]);
      const fieldKey = this.ensureGuideField(
        input.fields,
        input.fieldKeyByLabel,
        label,
        this.normalizeGuideFieldTypeValue(definition.type) || this.inferFieldTypeV2(label, sampleValue),
      );
      const field = input.fields.find((item) => item.key === fieldKey);
      if (field && definition.required !== undefined) {
        field.required = definition.required;
      }
    }

    for (const [rawLabel, rawValue] of Object.entries(rawTestData)) {
      const label = this.normalizeGuideLabelV2(rawLabel);
      const value = String(rawValue ?? '').trim();
      if (!label || !value) {
        continue;
      }
      if (isAuthCredentialField({ label })) {
        continue;
      }

      const fieldKey = this.ensureGuideField(
        input.fields,
        input.fieldKeyByLabel,
        label,
        this.inferFieldTypeV2(label, value),
      );
      normalizedTestData[fieldKey] = value;
    }

    return normalizedTestData;
  }

  private tryAssignGuidePlatformConfig(target: Record<string, any>, line: string) {
    const match = line.match(/^(入口链接|入口地址|入口URL|入口Url|入口url|打开地址|OA地址|OA 地址|执行方式|目标系统|跳转链接模板|票据服务地址)\s*[:：]\s*(.+)$/u);
    if (!match) {
      return false;
    }

    const rawKey = match[1].replace(/\s+/g, '');
    const value = match[2]?.trim();
    if (!value) {
      return true;
    }

    if (['入口链接', '入口地址', '入口URL', '入口Url', '入口url', '打开地址', 'OA地址', 'OA地址'].includes(rawKey)) {
      target.entryUrl = value;
      return true;
    }

    if (rawKey === '执行方式') {
      target.executorMode = this.normalizeExecutorModeValue(value) || value;
      return true;
    }

    if (rawKey === '目标系统') {
      target.targetSystem = value;
      return true;
    }

    if (rawKey === '跳转链接模板') {
      target.jumpUrlTemplate = value;
      return true;
    }

    if (rawKey === '票据服务地址') {
      target.ticketBrokerUrl = value;
      return true;
    }

    return false;
  }

  private ensureGuideField(
    fields: Array<Record<string, any>>,
    fieldKeyByLabel: Map<string, string>,
    label: string,
    type: string,
  ) {
    const existingFieldKey = fieldKeyByLabel.get(label);
    if (existingFieldKey) {
      return existingFieldKey;
    }

    const baseFieldKey = this.toFieldKey(label, fields.length + 1);
    let fieldKey = baseFieldKey;
    let suffix = 2;

    while (fields.some((field) => field.key === fieldKey)) {
      fieldKey = `${baseFieldKey}_${suffix}`;
      suffix += 1;
    }

    fields.push({
      key: fieldKey,
      label,
      type,
      required: true,
    });
    fieldKeyByLabel.set(label, fieldKey);
    return fieldKey;
  }

  private stripGuideLeadWordsV2(value: string) {
    let normalized = value.trim();

    while (/^(先|然后|再|接着|接下来|随后|最后|之后)\s*/u.test(normalized)) {
      normalized = normalized.replace(/^(先|然后|再|接着|接下来|随后|最后|之后)\s*/u, '').trim();
    }

    return normalized;
  }

  private parseGuideInstructionV2(line: string, commands: string[]) {
    const command = commands.find((item) => line.startsWith(item));
    if (!command) {
      return null;
    }

    const rest = line.slice(command.length).trim();
    if (!rest) {
      return null;
    }

    const assignmentMatch = rest.match(/^(.+?)(?:\s*(?:为|填为|输入为|写为|[:：=])\s*)(.+)$/u);
    const label = this.normalizeGuideLabelV2(assignmentMatch ? assignmentMatch[1] : rest);
    const value = assignmentMatch?.[2]?.trim() || undefined;

    if (!label) {
      return null;
    }

    return { label, value };
  }

  private parseGuideClickInstructionV2(line: string) {
    const commands = ['点击', '单击', '打开', '进入', '提交', '确认'];
    const command = commands.find((item) => line.startsWith(item));
    if (!command) {
      return null;
    }

    const rest = line.slice(command.length).trim();
    const label = this.normalizeGuideLabelV2(rest || command);
    return label || command;
  }

  private normalizeGuideLabelV2(value: string) {
    return value
      .replace(/["“”'‘’]/gu, '')
      .replace(/^(?:请先|请)\s+/u, '')
      .replace(/(按钮|菜单|链接|页面|页签|输入框|字段)$/u, '')
      .trim();
  }

  private inferFieldTypeV2(label: string, sampleValue?: string) {
    const text = `${label} ${sampleValue || ''}`.toLowerCase();
    if (text.includes('日期') || text.includes('时间') || /\d{4}-\d{1,2}-\d{1,2}/.test(text)) return 'date';
    if (text.includes('附件') || text.includes('文件')) return 'file';
    if (text.includes('原因') || text.includes('说明') || text.includes('备注') || text.includes('内容')) return 'textarea';
    return 'text';
  }

  private normalizeExecutorModeValue(value: unknown) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'browser' || normalized === '浏览器') return 'browser';
    if (normalized === 'local' || normalized === '本地') return 'local';
    if (normalized === 'http' || normalized === '接口') return 'http';
    if (normalized === 'stub' || normalized === '模拟') return 'stub';
    return undefined;
  }

  private sanitizeBootstrapJob<T extends { authConfig?: any } | null>(job: T): T {
    if (!job || !job.authConfig || typeof job.authConfig !== 'object' || Array.isArray(job.authConfig)) {
      return job;
    }

    return {
      ...job,
      authConfig: this.sanitizeAuthConfig(job.authConfig as Record<string, any>),
    };
  }

  private sanitizeAuthConfig(authConfig: Record<string, any>) {
    const sanitized = Object.fromEntries(
      Object.entries(authConfig).filter(([key]) => !BOOTSTRAP_SENSITIVE_AUTH_KEYS.has(key)),
    );

    const platformConfig = authConfig.platformConfig;
    if (platformConfig && typeof platformConfig === 'object' && !Array.isArray(platformConfig)) {
      sanitized.platformConfig = Object.fromEntries(
        Object.entries(platformConfig as Record<string, any>).filter(([key]) => !BOOTSTRAP_SENSITIVE_AUTH_KEYS.has(key)),
      );
    }

    return sanitized;
  }

  async deleteJob(jobId: string, tenantId: string) {
    const job = await this.prisma.bootstrapJob.findFirst({
      where: { id: jobId, tenantId },
    });

    if (!job) throw new NotFoundException('初始化任务不存在');

    if (job.connectorId) {
      await this.prisma.connector.delete({ where: { id: job.connectorId } });
    }

    await this.prisma.bootstrapJob.delete({ where: { id: jobId } });

    return { deleted: true, jobId };
  }

  private async enqueueBootstrapJob(jobId: string, status: string) {
    const queueJobId = randomUUID();
    const now = new Date();

    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        status,
        currentStage: status,
        queueJobId,
        stageStartedAt: now,
        lastHeartbeatAt: now,
        stalledReason: null,
      },
    });

    try {
      await this.bootstrapQueue.add(
        'process',
        { jobId, queueJobId },
        {
          jobId: queueJobId,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
    } catch (error: any) {
      const reason = `Bootstrap job enqueue failed: ${error.message}`;
      await this.prisma.bootstrapJob.update({
        where: { id: jobId },
        data: {
          stalledReason: reason,
          lastError: reason,
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {});
      throw error;
    }
  }
}
