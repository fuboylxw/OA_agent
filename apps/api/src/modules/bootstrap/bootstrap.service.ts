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
import { normalizeIdentityScope } from '../common/identity-scope.util';
import {
  buildPageAutomationFlowBundle,
  buildPageAutomationFlowBundleFromStructuredGuideDocument,
  type StructuredGuideDocument,
} from '../process-library/process-library-authoring.util';

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
    const selectedConnector = dto.connectorId
      ? await this.prisma.connector.findFirst({
          where: {
            id: dto.connectorId,
            tenantId,
          },
          select: {
            id: true,
            name: true,
            baseUrl: true,
            identityScope: true,
            authConfig: true,
          },
        })
      : null;
    if (dto.connectorId && !selectedConnector) {
      throw new NotFoundException('所属连接器不存在');
    }

    const effectiveName = (selectedConnector?.name || dto.name || '').trim() || undefined;
    const effectiveOaUrl = (selectedConnector?.baseUrl || dto.oaUrl || '').trim() || undefined;
    const requestedIdentityScope = typeof dto.identityScope === 'string' ? dto.identityScope.trim() : '';
    const effectiveIdentityScope = normalizeIdentityScope(selectedConnector?.identityScope || dto.identityScope);
    if (!selectedConnector && !effectiveOaUrl) {
      throw new BadRequestException('创建新连接器时必须提供系统网址');
    }
    if (!selectedConnector && !requestedIdentityScope) {
      throw new BadRequestException('创建新连接器时必须指定适用身份范围');
    }
    const now = new Date();
    const accessMode = this.resolveAccessMode({
      accessMode: dto.accessMode,
      bootstrapMode: dto.bootstrapMode,
    });
    const normalizedRpaContent = dto.rpaFlowContent
      ? await this.preparePageAutomationSource(dto.rpaFlowContent, {
          accessMode,
          connectorName: effectiveName,
          oaUrl: effectiveOaUrl,
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

    if (!apiDocContent && !effectiveOaUrl && !normalizedRpaContent?.content) {
      throw new BadRequestException('请提供接口文档、OA 地址或页面流程内容');
    }

    const inheritedAuthConfig = selectedConnector?.authConfig
      && typeof selectedConnector.authConfig === 'object'
      && !Array.isArray(selectedConnector.authConfig)
      ? (selectedConnector.authConfig as Record<string, any>)
      : undefined;
    const normalizedAuthConfig = dto.authConfig !== undefined
      ? this.normalizeAuthConfig(dto.authConfig)
      : this.normalizeAuthConfig(inheritedAuthConfig);
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
        connectorId: selectedConnector?.id,
        name: effectiveName,
        identityScope: effectiveIdentityScope,
        status: 'CREATED',
        currentStage: 'CREATED',
        stageStartedAt: now,
        lastHeartbeatAt: now,
        oaUrl: effectiveOaUrl,
        openApiUrl: dto.apiDocUrl,
        authConfig: authConfig ?? undefined,
      },
    });

    if (effectiveOaUrl) {
      await this.prisma.bootstrapSource.create({
        data: {
          bootstrapJobId: job.id,
          sourceType: 'oa_url',
          sourceUrl: effectiveOaUrl,
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
      identityScope?: 'teacher' | 'student' | 'both';
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
    const nextIdentityScope = normalizeIdentityScope(newDoc?.identityScope || job.identityScope);
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
        identityScope: nextIdentityScope,
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
    const compilerAccessMode = input.accessMode === 'direct_link'
      ? 'direct_link'
      : (input.accessMode === 'text_guide' ? 'text_guide' : null);
    const definitions = parseRpaFlowDefinitions(rpaFlowContent);
    if (definitions.length > 0) {
      if (!compilerAccessMode) {
        throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
      }
      if (
        input.accessMode === 'text_guide'
        && definitions.some((definition) =>
          this.isDirectLinkDefinition(definition)
          || this.hasNetworkRequest((definition as Record<string, any>)?.runtime?.networkSubmit)
          || this.hasNetworkRequest((definition as Record<string, any>)?.runtime?.networkStatus),
        )
      ) {
        throw new BadRequestException('文字示教接入不能使用链接直达流程定义，请改为链接直达模式');
      }
      const normalized = buildPageAutomationFlowBundle({
        content: rpaFlowContent,
        accessMode: compilerAccessMode,
        connectorBaseUrl: input.oaUrl,
        platformConfig: input.platformConfig,
        processName: input.connectorName,
      });
      return { content: JSON.stringify(normalized) };
    }

    const trimmedContent = rpaFlowContent.trim();
    if (input.accessMode === 'direct_link' && /^[{\[]/.test(trimmedContent)) {
      throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
    }

    if (input.accessMode !== 'text_guide' && input.accessMode !== 'direct_link') {
      throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
    }

    let finalized: ReturnType<typeof buildPageAutomationFlowBundle>;
    try {
      finalized = buildPageAutomationFlowBundle({
        content: rpaFlowContent,
        accessMode: compilerAccessMode,
        connectorBaseUrl: input.oaUrl,
        platformConfig: input.platformConfig,
        processName: input.connectorName,
      });
    } catch {
      const parsedDocument = await this.tryBuildTextGuideFlowBundleWithLlm(rpaFlowContent, input);
      if (!parsedDocument) {
        throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
      }
      finalized = buildPageAutomationFlowBundleFromStructuredGuideDocument({
        parsedDocument,
        accessMode: compilerAccessMode,
        connectorBaseUrl: input.oaUrl,
        platformConfig: input.platformConfig,
        processName: input.connectorName,
      });
    }
    return {
      content: JSON.stringify(finalized),
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

  private async tryBuildTextGuideFlowBundleWithLlm(
    guideText: string,
    input: {
      connectorName?: string;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ): Promise<StructuredGuideDocument | null> {
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

      return {
        sharedSteps: Array.isArray(parsedDocument.sharedSteps)
          ? parsedDocument.sharedSteps.map((step) => String(step || '').trim()).filter(Boolean)
          : [],
        platformConfig: parsedDocument.platformConfig && typeof parsedDocument.platformConfig === 'object' && !Array.isArray(parsedDocument.platformConfig)
          ? { ...parsedDocument.platformConfig }
          : {},
        flows: Array.isArray(parsedDocument.flows)
          ? parsedDocument.flows.map((flow) => ({
              processName: String(flow.processName || '').trim(),
              ...(String(flow.processCode || '').trim() ? { processCode: String(flow.processCode).trim() } : {}),
              ...(String(flow.description || '').trim() ? { description: String(flow.description).trim() } : {}),
              steps: Array.isArray(flow.steps)
                ? flow.steps.map((step) => String(step || '').trim()).filter(Boolean)
                : [],
              fields: Array.isArray(flow.fields)
                ? flow.fields.map((field) => ({
                    label: String(field.label || '').trim(),
                    ...(String(field.fieldKey || '').trim() ? { fieldKey: String(field.fieldKey).trim() } : {}),
                    ...(String(field.type || '').trim() ? { type: String(field.type).trim() } : {}),
                    ...(typeof field.required === 'boolean' ? { required: field.required } : {}),
                    ...(String(field.description || '').trim() ? { description: String(field.description).trim() } : {}),
                    ...(String(field.example || '').trim() ? { example: String(field.example).trim() } : {}),
                    ...(typeof field.multiple === 'boolean' ? { multiple: field.multiple } : {}),
                    ...(Array.isArray(field.options)
                      ? {
                          options: field.options
                            .map((option) => String(option || '').trim())
                            .filter(Boolean),
                        }
                      : {}),
                  })).filter((field) => field.label)
                : [],
              testData: flow.testData && typeof flow.testData === 'object' && !Array.isArray(flow.testData)
                ? Object.fromEntries(
                    Object.entries(flow.testData)
                      .map(([key, value]) => [String(key || '').trim(), String(value ?? '').trim()])
                      .filter(([key, value]) => key && value),
                  )
                : {},
              platformConfig: flow.platformConfig && typeof flow.platformConfig === 'object' && !Array.isArray(flow.platformConfig)
                ? { ...flow.platformConfig }
                : {},
            })).filter((flow) => flow.processName && flow.steps.length > 0)
          : [],
      };
    } catch (error: any) {
      this.logger.warn(`LLM text-guide parser failed, fallback to rules: ${error.message}`);
      return null;
    }
  }

  private isDirectLinkDefinition(definition: Record<string, any> | null | undefined) {
    if (!definition || typeof definition !== 'object') {
      return false;
    }

    const metadata = definition.metadata && typeof definition.metadata === 'object'
      ? definition.metadata as Record<string, any>
      : {};
    const accessMode = String(definition.accessMode || metadata.accessMode || '').trim().toLowerCase();
    const sourceType = String(definition.sourceType || metadata.sourceType || '').trim().toLowerCase();

    return accessMode === 'direct_link' || sourceType === 'direct_link';
  }

  private hasNetworkRequest(value: unknown) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof (value as Record<string, any>).url === 'string'
      && (value as Record<string, any>).url.trim(),
    );
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

    if (job.connectorId && ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(job.status)) {
      throw new BadRequestException('已发布并绑定连接器的初始化任务不可删除');
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
