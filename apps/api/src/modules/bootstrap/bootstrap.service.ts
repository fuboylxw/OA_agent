import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { WorkerAvailabilityService } from './worker-availability.service';
import { parseRpaFlowDefinitions } from '@uniflow/shared-types';
import { TextGuideLlmParserService } from './text-guide-llm-parser.service';
import {
  buildAuthCredentialPlaceholder,
  detectAuthCredentialFieldKind,
  isAuthCredentialField,
} from '../common/auth-field.util';
import { normalizeIdentityScope } from '../common/identity-scope.util';

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
  'evaluate',
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
    const definitions = parseRpaFlowDefinitions(rpaFlowContent);
    if (definitions.length > 0) {
      const normalized = this.normalizeParsedPageAutomationSource(
        definitions as Array<Record<string, any>>,
        input,
      );
      return { content: JSON.stringify(normalized) };
    }

    const trimmedContent = rpaFlowContent.trim();
    if (input.accessMode === 'direct_link' && /^[{\[]/.test(trimmedContent)) {
      throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
    }

    if (input.accessMode !== 'text_guide' && input.accessMode !== 'direct_link') {
      throw new BadRequestException('页面流程内容无效，无法识别可执行步骤');
    }

    const generated = (await this.tryBuildTextGuideFlowBundleWithLlm(rpaFlowContent, input))
      || this.buildTextGuideFlowBundleFromDescription(rpaFlowContent, {
        connectorName: input.connectorName,
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });

    const finalized = this.applyGuideAccessMode(
      generated,
      input.accessMode,
      {
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      },
    );
    this.validateGeneratedTextGuideFlowBundle(finalized, {
      accessMode: input.accessMode,
      oaUrl: input.oaUrl,
      platformConfig: input.platformConfig,
    });
    return {
      content: JSON.stringify(finalized),
      guideText: rpaFlowContent,
    };
  }

  private normalizeParsedPageAutomationSource(
    definitions: Array<Record<string, any>>,
    input: {
      accessMode?: BootstrapAccessMode;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    const bundle = {
      flows: definitions.map((definition) => JSON.parse(JSON.stringify(definition))),
    };

    if (input.accessMode === 'direct_link') {
      const normalized = this.applyGuideAccessMode(bundle, input.accessMode, {
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });
      this.validateGeneratedTextGuideFlowBundle(normalized, {
        accessMode: input.accessMode,
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });
      return normalized;
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

    if (input.accessMode === 'text_guide') {
      this.validateGeneratedTextGuideFlowBundle(bundle, {
        accessMode: input.accessMode,
        oaUrl: input.oaUrl,
        platformConfig: input.platformConfig,
      });
    }

    return bundle;
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
    if (this.looksLikeAttachmentField(text)) return 'file';
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
    if (ascii) {
      return ascii;
    }

    const stableSuffix = createHash('sha1')
      .update(String(name || '').trim() || 'text_guided_flow')
      .digest('hex')
      .slice(0, 8);
    return `flow_${stableSuffix}`;
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
        description: flow.description,
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
          description: flow.description,
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

  private applyGuideAccessMode(
    bundle: { flows?: Array<Record<string, any>> },
    accessMode: BootstrapAccessMode | undefined,
    input: {
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    if (!Array.isArray(bundle.flows) || bundle.flows.length === 0) {
      return bundle;
    }

    if (accessMode !== 'direct_link') {
      return bundle;
    }

    return {
      ...bundle,
      flows: bundle.flows.map((flow) => {
        const metadata = flow?.metadata && typeof flow.metadata === 'object'
          ? { ...(flow.metadata as Record<string, any>) }
          : {};
        const platform = flow?.platform && typeof flow.platform === 'object'
          ? { ...(flow.platform as Record<string, any>) }
          : {};

        if (!platform.businessBaseUrl && input.platformConfig?.businessBaseUrl) {
          platform.businessBaseUrl = input.platformConfig.businessBaseUrl;
        }
        if (!platform.targetBaseUrl && input.platformConfig?.targetBaseUrl) {
          platform.targetBaseUrl = input.platformConfig.targetBaseUrl;
        }
        if (!platform.businessBaseUrl && !platform.targetBaseUrl && input.oaUrl) {
          platform.businessBaseUrl = input.oaUrl;
          platform.targetBaseUrl = input.oaUrl;
        }

        return {
          ...this.buildDirectLinkRuntimeFlow({
            ...flow,
            platform,
          }),
          accessMode: 'direct_link',
          sourceType: 'direct_link',
          description: flow?.description === '根据文字示教自动生成的页面流程'
            ? '根据链接直达模板自动生成的页面流程'
            : (flow?.description || '根据链接直达模板自动生成的页面流程'),
          metadata: {
            ...metadata,
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          },
        };
      }),
    };
  }

  private buildDirectLinkRuntimeFlow(flow: Record<string, any>) {
    const platform = flow?.platform && typeof flow.platform === 'object'
      ? { ...(flow.platform as Record<string, any>) }
      : {};
    const runtime = flow?.runtime && typeof flow.runtime === 'object'
      ? { ...(flow.runtime as Record<string, any>) }
      : {};
    const existingNetworkSubmit = runtime.networkSubmit && typeof runtime.networkSubmit === 'object'
      ? { ...(runtime.networkSubmit as Record<string, any>) }
      : {};
    const submitSteps = Array.isArray(flow?.actions?.submit?.steps)
      ? flow.actions.submit.steps as Array<Record<string, any>>
      : [];
    const preflightSteps = this.buildDirectLinkPreflightSteps(flow, submitSteps);
    const queryStatus = flow?.actions?.queryStatus;
    const inferredJumpUrlTemplate = this.inferDirectLinkJumpUrlTemplate({
      platform,
      submitSteps,
      preflightSteps,
    });

    return {
      ...flow,
      platform: {
        ...platform,
        ...(!platform.jumpUrlTemplate && inferredJumpUrlTemplate
          ? { jumpUrlTemplate: inferredJumpUrlTemplate }
          : {}),
      },
      ...(queryStatus
        ? {
            actions: {
              queryStatus,
            },
          }
        : {
            actions: undefined,
          }),
      runtime: {
        ...runtime,
        executorMode: 'http',
        browserProvider: runtime.browserProvider || 'playwright',
        headless: false,
        snapshotMode: runtime.snapshotMode || 'structured-text',
        preflight: {
          steps: preflightSteps,
        },
        networkSubmit: {
          url: existingNetworkSubmit.url || '{{preflight.submitCapture.action}}',
          method: existingNetworkSubmit.method || '{{preflight.submitCapture.method}}',
          bodyMode: existingNetworkSubmit.bodyMode || '{{preflight.submitBodyMode}}',
          successMode: existingNetworkSubmit.successMode || 'http2xx',
          completionKind: existingNetworkSubmit.completionKind || this.inferDirectLinkCompletionKind(submitSteps),
          headers: {
            Origin: '{{preflight.submitOrigin}}',
            Referer: '{{jumpUrl}}',
            ...((existingNetworkSubmit.headers as Record<string, any> | undefined) || {}),
          },
          body: existingNetworkSubmit.body || {
            source: 'preflight.submitFields',
          },
          responseMapping: existingNetworkSubmit.responseMapping,
        },
      },
    };
  }

  private inferDirectLinkJumpUrlTemplate(input: {
    platform: Record<string, any>;
    submitSteps: Array<Record<string, any>>;
    preflightSteps: Array<Record<string, any>>;
  }) {
    const businessOrigin = this.tryGetUrlOrigin(
      input.platform.businessBaseUrl,
      input.platform.targetBaseUrl,
      input.platform.targetSystem,
    );
    const entryUrl = String(input.platform.entryUrl || '').trim();
    const stepUrls = this.collectDirectLinkStepUrls([
      ...input.submitSteps,
      ...input.preflightSteps,
    ]);

    if (stepUrls.length === 0) {
      return undefined;
    }

    if (businessOrigin) {
      const matchedBusinessUrl = [...stepUrls]
        .reverse()
        .find((value) => this.safeSameOrigin(value, businessOrigin));
      if (matchedBusinessUrl) {
        return matchedBusinessUrl;
      }
    }

    const matchedBusinessPath = [...stepUrls]
      .reverse()
      .find((value) => {
        const normalized = this.normalizeDirectLinkStepUrl(value);
        if (!normalized) {
          return false;
        }
        if (entryUrl && normalized === entryUrl) {
          return false;
        }
        return !this.safeSameOrigin(normalized, entryUrl);
      });
    if (matchedBusinessPath) {
      return matchedBusinessPath;
    }

    return stepUrls[stepUrls.length - 1];
  }

  private collectDirectLinkStepUrls(steps: Array<Record<string, any>>) {
    return steps
      .filter((step) => String(step?.type || '').trim().toLowerCase() === 'goto')
      .map((step) => this.normalizeDirectLinkStepUrl(step?.value))
      .filter((value): value is string => Boolean(value));
  }

  private normalizeDirectLinkStepUrl(value: unknown) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) {
      return undefined;
    }
    return raw;
  }

  private tryGetUrlOrigin(...values: unknown[]) {
    for (const value of values) {
      const raw = String(value || '').trim();
      if (!raw) {
        continue;
      }
      try {
        return new URL(raw).origin;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private safeSameOrigin(left: string, right: string) {
    if (!left || !right) {
      return false;
    }
    try {
      return new URL(left).origin === new URL(right).origin;
    } catch {
      return left === right;
    }
  }

  private buildDirectLinkPreflightSteps(
    flow: Record<string, any>,
    submitSteps: Array<Record<string, any>>,
  ) {
    const triggerIndex = this.findDirectLinkSubmitTriggerIndex(submitSteps);
    const preparationSteps = (triggerIndex >= 0 ? submitSteps.slice(0, triggerIndex) : submitSteps)
      .filter((step) => !['input', 'select'].includes(String(step?.type || '').trim().toLowerCase()))
      .map((step) => ({ ...step }));
    return [
      ...preparationSteps,
      this.buildDirectLinkCaptureStep(flow, submitSteps[triggerIndex]),
    ];
  }

  private findDirectLinkSubmitTriggerIndex(steps: Array<Record<string, any>>) {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (String(steps[index]?.type || '').trim().toLowerCase() === 'click') {
        return index;
      }
    }

    return -1;
  }

  private buildDirectLinkCaptureStep(
    flow: Record<string, any>,
    triggerStep?: Record<string, any>,
  ) {
    const fields = Array.isArray(flow?.fields) ? flow.fields as Array<Record<string, any>> : [];
    const triggerLabel = String(
      triggerStep?.target?.label
      || triggerStep?.target?.value
      || triggerStep?.value
      || '提交',
    ).trim() || '提交';

    return {
      type: 'evaluate',
      builtin: 'capture_form_submit',
      description: `捕获“${triggerLabel}”对应的网络提交请求`,
      options: {
        fieldMappings: fields
          .filter((field) => String(field?.type || '').trim().toLowerCase() !== 'file')
          .map((field) => ({
            fieldKey: field.key,
            sources: [field.key, field.label].filter(Boolean),
            target: {
              label: field.label,
            },
          })),
        fileMappings: fields
          .filter((field) => String(field?.type || '').trim().toLowerCase() === 'file')
          .map((field) => ({
            fieldKey: field.key,
            target: {
              label: field.label,
            },
          })),
        trigger: {
          text: triggerLabel,
          exact: true,
        },
        output: {
          captureKey: 'submitCapture',
          fieldsKey: 'submitFields',
          csrfKey: 'csrfToken',
          filledFieldsKey: 'filledFields',
          captureEventCountKey: 'captureEventCount',
          bodyModeKey: 'submitBodyMode',
          originKey: 'submitOrigin',
          attachmentFieldMapKey: 'attachmentFieldMap',
        },
      },
    };
  }

  private inferDirectLinkCompletionKind(steps: Array<Record<string, any>>) {
    const clickLabels = steps
      .filter((step) => String(step?.type || '').trim().toLowerCase() === 'click')
      .map((step) => String(step?.target?.label || step?.target?.value || step?.value || '').trim())
      .filter(Boolean);
    const triggerLabel = clickLabels[clickLabels.length - 1] || '';
    return /保存|草稿|待发/u.test(triggerLabel) ? 'draft' : 'submitted';
  }

  private validateGeneratedTextGuideFlowBundle(
    bundle: { flows?: Array<Record<string, any>> },
    input?: {
      accessMode?: BootstrapAccessMode;
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    const definitions = parseRpaFlowDefinitions(bundle);
    if (definitions.length === 0 || !Array.isArray(bundle.flows) || bundle.flows.length === 0) {
      throw new BadRequestException('Invalid text-guide output: no executable steps');
    }

    for (const flow of bundle.flows) {
      const submitSteps = flow?.actions?.submit?.steps;
      const preflightSteps = flow?.runtime?.preflight?.steps;
      const hasDirectLinkRuntime = input?.accessMode === 'direct_link'
        && Array.isArray(preflightSteps)
        && preflightSteps.length > 0
        && typeof flow?.runtime?.networkSubmit?.url === 'string'
        && flow.runtime.networkSubmit.url.trim();
      if ((!Array.isArray(submitSteps) || submitSteps.length === 0) && !hasDirectLinkRuntime) {
        throw new BadRequestException('Invalid text-guide output: no executable steps');
      }

      const stepsToValidate = Array.isArray(submitSteps) && submitSteps.length > 0
        ? submitSteps
        : preflightSteps;
      const invalidStep = stepsToValidate.find(
        (step) => !VALID_RPA_STEP_TYPES.has(String(step?.type || '')),
      );
      if (invalidStep) {
        throw new BadRequestException('Invalid text-guide output: unsupported step type');
      }

      if (input?.accessMode === 'direct_link' && !this.hasDirectLinkNavigationContext(flow, input)) {
        throw new BadRequestException('链接直达接入的文字模板必须至少包含一个可访问链接（如系统网址、流程页面或步骤中的 URL）');
      }
    }
  }

  private hasDirectLinkNavigationContext(
    flow: Record<string, any>,
    input?: {
      oaUrl?: string;
      platformConfig?: Record<string, any>;
    },
  ) {
    const platform = flow?.platform && typeof flow.platform === 'object'
      ? flow.platform as Record<string, any>
      : {};
    const portalSsoBridge = platform.portalSsoBridge && typeof platform.portalSsoBridge === 'object'
      ? platform.portalSsoBridge as Record<string, any>
      : {};
    const hasPlatformUrl = [
      platform.entryUrl,
      platform.jumpUrlTemplate,
      platform.businessBaseUrl,
      platform.targetBaseUrl,
      portalSsoBridge.portalUrl,
      input?.platformConfig?.entryUrl,
      input?.platformConfig?.jumpUrlTemplate,
      input?.platformConfig?.businessBaseUrl,
      input?.platformConfig?.targetBaseUrl,
      input?.oaUrl,
    ].some((value) => /^https?:\/\//i.test(String(value || '').trim()));

    if (hasPlatformUrl) {
      return true;
    }

    const actions = flow?.actions && typeof flow.actions === 'object'
      ? flow.actions as Record<string, any>
      : {};
    const runtime = flow?.runtime && typeof flow.runtime === 'object'
      ? flow.runtime as Record<string, any>
      : {};
    const stepGroups = [actions.submit?.steps, actions.queryStatus?.steps, runtime.preflight?.steps]
      .filter(Array.isArray)
      .flat() as Array<Record<string, any>>;

    return stepGroups.some((step) =>
      String(step?.type || '').trim().toLowerCase() === 'goto'
      && /^https?:\/\//i.test(String(step?.value || '').trim()),
    );
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

  private buildTextGuideFlowFromStepLines(input: {
    processName: string;
    processCode?: string;
    description?: string;
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

    const entryUrl = this.resolveGuideEntryUrl({
      platformConfig: input.platformConfig,
      oaUrl: input.oaUrl,
    });
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
      description: input.description?.trim() || '根据文字示教自动生成的页面流程',
      accessMode: 'text_guide',
      sourceType: 'text_guide',
      fields,
      ...(Object.keys(normalizedTestData).length > 0
        ? {
            metadata: {
              accessMode: 'text_guide',
              sourceType: 'text_guide',
              textGuide: {
                sampleData: normalizedTestData,
              },
            },
          }
        : {
            metadata: {
              accessMode: 'text_guide',
              sourceType: 'text_guide',
            },
          }),
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
        ...(input.platformConfig?.businessBaseUrl ? { businessBaseUrl: input.platformConfig.businessBaseUrl } : {}),
        ...(input.platformConfig?.targetBaseUrl ? { targetBaseUrl: input.platformConfig.targetBaseUrl } : {}),
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

  private resolveGuideEntryUrl(input: {
    platformConfig?: Record<string, any>;
    oaUrl?: string;
  }) {
    return String(
      input.platformConfig?.entryUrl
      || input.platformConfig?.jumpUrlTemplate
      || input.platformConfig?.targetBaseUrl
      || input.platformConfig?.businessBaseUrl
      || input.oaUrl
      || '',
    ).trim();
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
      description?: string;
      steps: string[];
      fields: Array<{
        label: string;
        fieldKey?: string;
        type?: string;
        required?: boolean;
        description?: string;
        example?: string;
        multiple?: boolean;
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
      description?: string;
      steps: string[];
      fields: Array<{
        label: string;
        fieldKey?: string;
        type?: string;
        required?: boolean;
        description?: string;
        example?: string;
        multiple?: boolean;
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

        const description = this.parseGuideDescriptionLine(line);
        if (description) {
          currentFlow.description = description;
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

  private parseGuideDescriptionLine(line: string) {
    const match = line.match(/^(?:描述|说明|简介|流程描述|description)\s*[:：]\s*(.+)$/iu);
    if (!match) {
      return null;
    }

    const description = match[1]
      ?.trim()
      ?.replace(/["“”'‘’]/gu, '');
    return description || null;
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
      const description = this.extractGuideFieldDescription(pipeSegments.slice(1));
      const example = this.extractGuideFieldExample(pipeSegments.slice(1));

      return {
        label,
        ...(type ? { type } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(description ? { description } : {}),
        ...(example ? { example } : {}),
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
      const description = this.extractGuideFieldDescription(tokens);
      const example = this.extractGuideFieldExample(tokens);

      return {
        label,
        ...(type ? { type } : {}),
        ...(required !== undefined ? { required } : {}),
        ...(description ? { description } : {}),
        ...(example ? { example } : {}),
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

  private extractGuideFieldDescription(tokens: string[]) {
    for (const token of tokens) {
      const match = String(token || '').trim().match(/^(?:说明|解释|描述|含义|用途|description|desc)\s*[:：=]\s*(.+)$/iu);
      const value = match?.[1]?.trim();
      if (value) {
        return value;
      }
    }

    return undefined;
  }

  private extractGuideFieldExample(tokens: string[]) {
    for (const token of tokens) {
      const match = String(token || '').trim().match(/^(?:示例|样例|例子|参考值|example|sample)\s*[:：=]\s*(.+)$/iu);
      const value = match?.[1]?.trim();
      if (value) {
        return value;
      }
    }

    return undefined;
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
    if (['file', '附件', 'upload'].includes(normalized)) return 'file';
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
      description?: string;
      example?: string;
      multiple?: boolean;
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
      if (field && definition.description) {
        field.description = String(definition.description).trim();
      }
      if (field && definition.example) {
        field.example = String(definition.example).trim();
      }
      if (field && definition.multiple !== undefined) {
        field.multiple = Boolean(definition.multiple);
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
      const field = input.fields.find((item) => item.key === fieldKey);
      if (field && !field.example) {
        field.example = value;
      }
      normalizedTestData[fieldKey] = value;
    }

    return normalizedTestData;
  }

  private tryAssignGuidePlatformConfig(target: Record<string, any>, line: string) {
    const match = line.match(/^(入口链接|入口地址|入口URL|入口Url|入口url|打开地址|OA地址|OA 地址|认证入口|登录入口|门户地址|门户首页|系统网址|系统地址|业务系统网址|业务系统地址|流程页面|页面链接|流程链接|目标页面|跳转页面|执行方式|目标系统|跳转链接模板|票据服务地址)\s*[:：]\s*(.+)$/u);
    if (!match) {
      return false;
    }

    const rawKey = match[1].replace(/\s+/g, '');
    const value = match[2]?.trim();
    if (!value) {
      return true;
    }

    if (['入口链接', '入口地址', '入口URL', '入口Url', '入口url', '打开地址', 'OA地址', '认证入口', '登录入口', '门户地址', '门户首页'].includes(rawKey)) {
      target.entryUrl = value;
      return true;
    }

    if (['系统网址', '系统地址', '业务系统网址', '业务系统地址'].includes(rawKey)) {
      target.businessBaseUrl = value;
      target.targetBaseUrl = value;
      return true;
    }

    if (['流程页面', '页面链接', '流程链接', '目标页面', '跳转页面'].includes(rawKey)) {
      target.jumpUrlTemplate = value;
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
      multiple: type === 'file' ? false : undefined,
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
    if (this.looksLikeAttachmentField(text)) return 'file';
    if (this.looksLikeNumericField(text)) return 'number';
    if (text.includes('原因') || text.includes('说明') || text.includes('备注') || text.includes('内容') || text.includes('事由')) return 'textarea';
    return 'text';
  }

  private looksLikeAttachmentField(text: string) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized.includes('附件')) {
      return true;
    }

    if (/(upload|上传)/.test(normalized)) {
      return true;
    }

    if (normalized.includes('文件')) {
      return /(附件|上传|扫描件|图片|照片|pdf|word|excel|压缩包)/.test(normalized);
    }

    return false;
  }

  private looksLikeNumericField(text: string) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized.includes('金额') || normalized.includes('预算')) {
      return true;
    }

    if (normalized.includes('数量') && !normalized.includes('文件类型')) {
      return true;
    }

    if (normalized.includes('天数') || normalized.includes('次数') || normalized.includes('时长')) {
      return true;
    }

    if (normalized.includes('份数')) {
      return !normalized.includes('文件类型') && !normalized.includes('名称');
    }

    return false;
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
