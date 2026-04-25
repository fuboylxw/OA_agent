import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  buildProcessRuntimeManifest,
  normalizeProcessName,
  parseRpaFlowDefinitions,
  toLegacyExecutionModesFromRuntimeManifest,
} from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { CreateProcessTemplateDto } from './dto/create-process-template.dto';
import { PreviewProcessTemplateDto } from './dto/preview-process-template.dto';
import { resolveAllowedIdentityScopes } from '../common/identity-scope.util';
import {
  buildProcessLibraryFlowDefinitions,
  buildPageAutomationFlowBundleFromStructuredGuideDocument,
  type ProcessLibraryApiToolDefinition,
  type ProcessLibraryAccessMode,
  type ProcessLibraryAuthoringMode,
  type ProcessLibraryInputMethod,
  type StructuredGuideDocument,
} from './process-library-authoring.util';
import { TextGuideLlmParserService } from '../bootstrap/text-guide-llm-parser.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { DeliveryOrchestratorService } from '../delivery-runtime/delivery-orchestrator.service';
import { inferSubmissionCompletionKind } from '../common/submission-status.util';

type ProcessLibraryItem = {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  description: string | null;
  version: number;
  status: string;
  falLevel: string | null;
  uiHints: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  sourceType: 'published';
  connector?: {
    id: string;
    name: string;
    identityScope: string;
    oaType: string;
    oclLevel: string;
  } | null;
};

type ProcessLibraryAccessContext = {
  identityType?: string;
  roles?: string[];
};

type ManualProcessTemplatePayload = {
  connectorId: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  description: string | null;
  falLevel: string;
  accessMode: ProcessLibraryAccessMode;
  authoringMode: ProcessLibraryAuthoringMode;
  inputMethod: ProcessLibraryInputMethod;
  authoringText: string | null;
  definition: Record<string, any>;
  apiTools: ProcessLibraryApiToolDefinition[];
  schemaFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  sourceHash: string;
  hasApiSubmit: boolean;
  hasApiQuery: boolean;
  hasUrlSubmit: boolean;
  hasUrlQuery: boolean;
  hasRpaSubmit: boolean;
  hasRpaQuery: boolean;
};

type ProcessLibraryMutationActor = {
  userId?: string;
};

type ProcessValidationStatus = 'running' | 'passed' | 'failed' | 'blocked' | 'pending';

@Injectable()
export class ProcessLibraryService {
  private readonly logger = new Logger(ProcessLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly textGuideLlmParserService: TextGuideLlmParserService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly deliveryOrchestrator: DeliveryOrchestratorService,
  ) {}

  async list(
    tenantId: string,
    category?: string,
    connectorId?: string,
    access?: ProcessLibraryAccessContext,
  ) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const publishedTemplates = await this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        status: 'published',
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
        ...(category && { processCategory: category }),
        ...(connectorId && { connectorId }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            identityScope: true,
            oaType: true,
            oclLevel: true,
          },
        },
      },
      orderBy: [
        { processCategory: 'asc' },
        { processName: 'asc' },
      ],
    });
    const hydratedTemplates = await this.hydrateBootstrapValidationResults(publishedTemplates);

    const publishedItems: ProcessLibraryItem[] = hydratedTemplates.map((template) => ({
      id: template.id,
      processCode: template.processCode,
      processName: normalizeProcessName({
        processName: template.processName,
        processCode: template.processCode,
      }),
      processCategory: template.processCategory || null,
      description: template.description || null,
      version: template.version,
      status: template.status,
      falLevel: template.falLevel,
      uiHints: (template.uiHints as Record<string, any> | null) || null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      sourceType: 'published',
      connector: template.connector,
    }));

    return [...publishedItems].sort((a, b) => {
      const categoryCompare = (a.processCategory || '').localeCompare(b.processCategory || '', 'zh-CN');
      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return a.processName.localeCompare(b.processName, 'zh-CN');
    });
  }

  async createManualProcessTemplate(
    tenantId: string,
    dto: CreateProcessTemplateDto,
    actor?: ProcessLibraryMutationActor,
  ) {
    const connector = await this.getManageableConnector(tenantId, dto.connectorId);
    const payload = await this.buildManualTemplatePayload(dto, connector);
    return this.publishManualProcessTemplate(tenantId, connector, payload, undefined, actor);
  }

  async updateManualProcessTemplate(
    tenantId: string,
    templateId: string,
    dto: CreateProcessTemplateDto,
    actor?: ProcessLibraryMutationActor,
  ) {
    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      select: {
        id: true,
        connectorId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('要修改的流程不存在');
    }

    if (existing.connectorId !== dto.connectorId) {
      throw new BadRequestException('修改流程时不允许变更所属连接器');
    }

    const connector = await this.getManageableConnector(tenantId, dto.connectorId);
    const payload = await this.buildManualTemplatePayload(dto, connector);
    return this.publishManualProcessTemplate(tenantId, connector, payload, templateId, actor);
  }

  async previewManualProcessTemplate(tenantId: string, dto: PreviewProcessTemplateDto) {
    const connector = dto.connectorId
      ? await this.getManageableConnector(tenantId, dto.connectorId)
      : {
          id: 'preview-connector',
          name: '流程预解析',
          identityScope: null,
          oaType: 'form-page',
          baseUrl: null,
        };

    const payload = await this.buildManualTemplatePayload({
      connectorId: dto.connectorId || connector.id,
      processName: dto.processName,
      description: dto.description,
      accessMode: dto.accessMode,
      authoringMode: dto.authoringMode,
      rpaFlowContent: dto.rpaFlowContent,
    }, connector);

    return {
      processCode: payload.processCode,
      processName: payload.processName,
      description: payload.description,
      accessMode: payload.accessMode,
    };
  }

  async archiveManualProcessTemplate(tenantId: string, templateId: string) {
    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      select: {
        id: true,
        connectorId: true,
        processCode: true,
        remoteProcessId: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('要删除的流程不存在');
    }

    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.processTemplate.updateMany({
        where: {
          tenantId,
          connectorId: existing.connectorId,
          processCode: existing.processCode,
          NOT: {
            status: 'archived',
          },
        },
        data: {
          status: 'archived',
        },
      });

      if (existing.remoteProcessId) {
        await tx.remoteProcess.update({
          where: {
            id: existing.remoteProcessId,
          },
          data: {
            latestTemplateId: null,
            status: 'disabled',
          },
        });
      }

      if (tx.mCPTool?.updateMany) {
        await tx.mCPTool.updateMany({
          where: {
            connectorId: existing.connectorId,
            flowCode: existing.processCode,
            toolName: {
              startsWith: `manual_${existing.processCode}_`,
            },
          },
          data: {
            enabled: false,
          },
        });
      }

      return {
        success: true,
        archivedCount: archived.count,
        processCode: existing.processCode,
      };
    });
  }

  async getByCode(
    tenantId: string,
    processCode: string,
    version?: number,
    connectorId?: string,
    access?: ProcessLibraryAccessContext,
  ) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode,
        status: 'published',
        ...(connectorId ? { connectorId } : {}),
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
        ...(version && { version }),
      },
      include: {
        connector: true,
      },
      orderBy: {
        version: 'desc',
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    const [hydratedTemplate] = await this.hydrateBootstrapValidationResults([template]);
    return hydratedTemplate || template;
  }

  async getById(id: string, tenantId: string, access?: ProcessLibraryAccessContext) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        id,
        tenantId,
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
      },
      include: {
        connector: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    const [hydratedTemplate] = await this.hydrateBootstrapValidationResults([template]);
    return hydratedTemplate || template;
  }

  async listVersions(tenantId: string, processCode: string, access?: ProcessLibraryAccessContext) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const templates = await this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        processCode,
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
      },
      orderBy: {
        version: 'desc',
      },
    });
    return this.hydrateBootstrapValidationResults(templates);
  }

  private normalizeProcessCode(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private deriveProcessCode(input: {
    explicitCode?: string | null;
    processName?: string | null;
  }) {
    const normalizedExplicitCode = this.normalizeProcessCode(String(input.explicitCode || ''));
    if (normalizedExplicitCode) {
      return normalizedExplicitCode;
    }

    const normalizedFromName = String(input.processName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (normalizedFromName) {
      return normalizedFromName;
    }

    const stableSuffix = createHash('sha1')
      .update(String(input.processName || '').trim() || 'process_library_flow')
      .digest('hex')
      .slice(0, 8);
    return `flow_${stableSuffix}`;
  }

  private templateContainsProcessCodeLine(source: string) {
    return String(source || '')
      .split(/\r?\n/)
      .some((line) => /^(?:流程编码|processCode)\s*[:：]/iu.test(String(line || '').trim()));
  }

  private async hydrateBootstrapValidationResults<
    T extends {
      connectorId?: string | null;
      processCode?: string | null;
      uiHints?: unknown;
    },
  >(templates: T[]): Promise<T[]> {
    const targets = templates.filter((template) =>
      template.connectorId
      && template.processCode
      && !this.hasValidationResult(template.uiHints),
    );
    if (targets.length === 0) {
      return templates;
    }

    const connectorIds = Array.from(new Set(
      targets
        .map((template) => String(template.connectorId || '').trim())
        .filter(Boolean),
    ));
    const processCodes = Array.from(new Set(
      targets
        .map((template) => String(template.processCode || '').trim())
        .filter(Boolean),
    ));
    if (connectorIds.length === 0 || processCodes.length === 0) {
      return templates;
    }

    const bootstrapJobs = await this.prisma.bootstrapJob.findMany({
      where: {
        connectorId: {
          in: connectorIds,
        },
        status: {
          in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'],
        },
        flowIRs: {
          some: {
            flowCode: {
              in: processCodes,
            },
          },
        },
      },
      select: {
        connectorId: true,
        completedAt: true,
        updatedAt: true,
        flowIRs: {
          where: {
            flowCode: {
              in: processCodes,
            },
          },
          select: {
            flowCode: true,
            metadata: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const fallbackByTemplateKey = new Map<string, Record<string, any>>();
    for (const job of bootstrapJobs) {
      const connectorId = String(job.connectorId || '').trim();
      if (!connectorId) {
        continue;
      }
      for (const flow of job.flowIRs || []) {
        const flowCode = String(flow.flowCode || '').trim();
        if (!flowCode) {
          continue;
        }
        const key = `${connectorId}::${flowCode}`;
        if (fallbackByTemplateKey.has(key)) {
          continue;
        }
        const validationResult = this.buildBootstrapValidationResultFromFlowIr(
          flow.metadata,
          job.completedAt || job.updatedAt || null,
        );
        if (validationResult) {
          fallbackByTemplateKey.set(key, validationResult);
        }
      }
    }

    return templates.map((template) => {
      const connectorId = String(template.connectorId || '').trim();
      const processCode = String(template.processCode || '').trim();
      const key = `${connectorId}::${processCode}`;
      const fallbackValidation = fallbackByTemplateKey.get(key);
      if (!fallbackValidation) {
        return template;
      }
      const uiHints = template.uiHints && typeof template.uiHints === 'object' && !Array.isArray(template.uiHints)
        ? { ...(template.uiHints as Record<string, any>) }
        : {};
      return {
        ...template,
        uiHints: {
          ...uiHints,
          validationResult: fallbackValidation,
        },
      };
    });
  }

  private hasValidationResult(uiHints: unknown) {
    return Boolean(
      uiHints
      && typeof uiHints === 'object'
      && !Array.isArray(uiHints)
      && (uiHints as Record<string, any>).validationResult
      && typeof (uiHints as Record<string, any>).validationResult === 'object'
      && !Array.isArray((uiHints as Record<string, any>).validationResult),
    );
  }

  private buildBootstrapValidationResultFromFlowIr(
    metadata: unknown,
    checkedAt: Date | null,
  ) {
    const flowMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, any>
      : null;
    const validation = flowMetadata?.validation && typeof flowMetadata.validation === 'object' && !Array.isArray(flowMetadata.validation)
      ? flowMetadata.validation as Record<string, any>
      : null;
    if (!validation) {
      return null;
    }

    const rawStatus = String(validation.status || '').trim();
    const status = rawStatus === 'passed'
      ? 'passed'
      : rawStatus === 'partial'
        ? 'blocked'
        : rawStatus || 'failed';

    return {
      status,
      reason: String(validation.reason || '').trim() || '初始化中心已完成流程校验。',
      ...(checkedAt ? { checkedAt: checkedAt.toISOString() } : {}),
      checkedMode: 'bootstrap_validation',
      ...(validation.failureType !== undefined ? { failureType: validation.failureType } : {}),
      ...(validation.repairable !== undefined ? { repairable: validation.repairable } : {}),
      ...(validation.endpointCheckedCount !== undefined ? { endpointCheckedCount: validation.endpointCheckedCount } : {}),
      ...(validation.endpointPassedCount !== undefined ? { endpointPassedCount: validation.endpointPassedCount } : {}),
      ...(validation.endpointFailedCount !== undefined ? { endpointFailedCount: validation.endpointFailedCount } : {}),
      ...(Array.isArray(validation.failedEndpoints) ? { failedEndpoints: validation.failedEndpoints } : {}),
      ...(validation.error !== undefined ? { error: validation.error } : {}),
    };
  }

  private buildConnectorScopeFilter(access?: ProcessLibraryAccessContext) {
    if (access?.roles?.some((role) => role === 'admin' || role === 'flow_manager')) {
      return undefined;
    }

    return {
      identityScope: {
        in: resolveAllowedIdentityScopes(access?.identityType),
      },
    } satisfies Prisma.ConnectorWhereInput;
  }

  private scheduleAutoValidation(input: {
    tenantId: string;
    templateId: string;
    connectorId: string;
    processCode: string;
    processName: string;
    accessMode: ProcessLibraryAccessMode;
    userId?: string;
  }) {
    setTimeout(() => {
      void this.autoValidatePublishedTemplate(input).catch((error) => {
        const message = error instanceof Error ? error.message : '自动校验失败';
        this.logger.warn(`Auto validation failed for ${input.processCode}: ${message}`);
        void this.updateTemplateValidationResult(input.templateId, {
          status: 'failed',
          reason: `系统自动校验失败：${message}`,
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_preflight',
        }).catch(() => undefined);
      });
    }, 0);
  }

  private inferSafeAutoValidationCompletionKind(definition: Record<string, any>) {
    const metadata = definition?.metadata && typeof definition.metadata === 'object'
      ? definition.metadata as Record<string, any>
      : {};
    const runtime = definition?.runtime && typeof definition.runtime === 'object'
      ? definition.runtime as Record<string, any>
      : {};
    const networkSubmit = runtime.networkSubmit && typeof runtime.networkSubmit === 'object'
      ? runtime.networkSubmit as Record<string, any>
      : {};
    const explicitKind = String(networkSubmit.completionKind || '').trim().toLowerCase();
    if (explicitKind === 'draft' || explicitKind === 'submitted') {
      return explicitKind as 'draft' | 'submitted';
    }

    const clickLabels = Array.isArray(definition?.actions?.submit?.steps)
      ? (definition.actions.submit.steps as Array<Record<string, any>>)
        .filter((step) => String(step?.type || '').trim().toLowerCase() === 'click')
        .map((step) => String(step?.target?.label || step?.target?.value || step?.value || '').trim())
        .filter(Boolean)
      : [];
    const lastClickLabel = clickLabels[clickLabels.length - 1] || '';
    if (/保存|草稿|待发/u.test(lastClickLabel)) {
      return 'draft';
    }

    const manualApiTools = Array.isArray(metadata.manualApi?.tools)
      ? metadata.manualApi.tools as Array<Record<string, any>>
      : [];
    const submitApiTool = manualApiTools.find((tool) => String(tool?.category || '').trim().toLowerCase() === 'submit');
    const submitUrl = String(networkSubmit.url || submitApiTool?.apiEndpoint || '').trim();
    const inferredFromRequest = inferSubmissionCompletionKind({
      metadata: {
        request: {
          url: submitUrl,
        },
      },
    });
    return inferredFromRequest === 'draft' ? 'draft' : 'submitted';
  }

  private resolveAutoValidationFormData(definition: Record<string, any>) {
    const fields = Array.isArray(definition?.fields)
      ? definition.fields as Array<Record<string, any>>
      : [];
    const metadata = definition?.metadata && typeof definition.metadata === 'object'
      ? definition.metadata as Record<string, any>
      : {};
    const textTemplate = metadata.textTemplate && typeof metadata.textTemplate === 'object'
      ? metadata.textTemplate as Record<string, any>
      : {};
    const sampleData = textTemplate.sampleData && typeof textTemplate.sampleData === 'object'
      ? textTemplate.sampleData as Record<string, any>
      : {};

    const formData: Record<string, any> = {};
    const attachments: Array<{
      filename: string;
      content: Buffer;
      mimeType?: string;
      fieldKey?: string | null;
    }> = [];
    const missingRequiredFields: string[] = [];

    for (const field of fields) {
      const fieldKey = String(field?.key || '').trim();
      const label = String(field?.label || fieldKey || '').trim();
      const type = String(field?.type || 'text').trim().toLowerCase();
      const required = field?.required !== false;
      const candidate = sampleData[fieldKey]
        ?? sampleData[label]
        ?? field?.example
        ?? field?.defaultValue
        ?? null;

      if (type === 'file') {
        if (!fieldKey) {
          continue;
        }

        const filename = String(candidate || `${fieldKey}.txt`).trim() || `${fieldKey}.txt`;
        attachments.push({
          filename,
          fieldKey,
          mimeType: this.inferAutoValidationMimeType(filename),
          content: Buffer.from(`Auto validation attachment for ${label || fieldKey}`, 'utf-8'),
        });
        continue;
      }

      let resolvedValue = candidate;
      if ((resolvedValue === null || resolvedValue === undefined || resolvedValue === '') && Array.isArray(field?.options) && field.options.length > 0) {
        const firstOption = field.options[0];
        resolvedValue = String(firstOption?.value || firstOption?.label || '').trim();
      }

      if (resolvedValue === null || resolvedValue === undefined || resolvedValue === '') {
        if (required) {
          missingRequiredFields.push(label || fieldKey || '未命名字段');
        }
        continue;
      }

      if (field?.multiple === true && typeof resolvedValue === 'string') {
        const parts = resolvedValue
          .split(/[、,，\n]/)
          .map((item) => item.trim())
          .filter(Boolean);
        formData[fieldKey] = parts.length > 1 ? parts : resolvedValue;
        continue;
      }

      if (fieldKey) {
        formData[fieldKey] = resolvedValue;
      }
    }

    return {
      formData,
      attachments,
      missingRequiredFields,
    };
  }

  private inferAutoValidationMimeType(filename: string) {
    const normalized = filename.trim().toLowerCase();
    if (normalized.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (normalized.endsWith('.png')) {
      return 'image/png';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalized.endsWith('.doc')) {
      return 'application/msword';
    }
    if (normalized.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (normalized.endsWith('.xls')) {
      return 'application/vnd.ms-excel';
    }
    if (normalized.endsWith('.xlsx')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    return 'text/plain';
  }

  private async autoValidatePublishedTemplate(input: {
    tenantId: string;
    templateId: string;
    connectorId: string;
    processCode: string;
    processName: string;
    accessMode: ProcessLibraryAccessMode;
    userId?: string;
  }) {
    const currentTemplate = await this.prisma.processTemplate.findUnique({
      where: { id: input.templateId },
      select: {
        id: true,
        uiHints: true,
      },
    });
    const uiHints = currentTemplate?.uiHints && typeof currentTemplate.uiHints === 'object' && !Array.isArray(currentTemplate.uiHints)
      ? currentTemplate.uiHints as Record<string, any>
      : {};
    const definition = uiHints.rpaDefinition && typeof uiHints.rpaDefinition === 'object' && !Array.isArray(uiHints.rpaDefinition)
      ? uiHints.rpaDefinition as Record<string, any>
      : {};
    const requestedFlow = [{
      flowCode: input.processCode,
      flowName: input.processName,
    }];

    const connectorAuthSeed = await this.prisma.connector.findFirst({
      where: {
        id: input.connectorId,
        tenantId: input.tenantId,
      },
      select: {
        id: true,
        authType: true,
        authConfig: true,
        secretRef: {
          select: {
            secretProvider: true,
            secretPath: true,
            secretVersion: true,
          },
        },
      },
    });
    const resolvedAuthConfig = await this.adapterRuntimeService.resolveAuthConfigForExecution({
      id: input.connectorId,
      authType: String(connectorAuthSeed?.authType || 'cookie'),
      authConfig: connectorAuthSeed?.authConfig,
      secretRef: connectorAuthSeed?.secretRef,
    }, {
      tenantId: input.tenantId,
      userId: input.userId,
    }).catch(() => null);
    const authReadiness = this.evaluateAutoValidationAuthReadiness(resolvedAuthConfig, definition);
    if (!authReadiness.ready) {
      await this.updateTemplateValidationResult(input.templateId, {
        status: 'blocked',
        reason: authReadiness.reason,
        checkedAt: new Date().toISOString(),
        checkedMode: 'system_preflight',
      });
      return;
    }

    if (input.accessMode === 'api') {
      const adapter = await this.adapterRuntimeService.createApiAdapterForConnector(
        input.connectorId,
        requestedFlow,
        {
          tenantId: input.tenantId,
          userId: input.userId,
        },
      );

      if (!adapter) {
        await this.updateTemplateValidationResult(input.templateId, {
          status: 'failed',
          reason: '系统自动校验失败：未找到可用的 API 适配器',
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_preflight',
        });
        return;
      }

      try {
        const health = await adapter.healthCheck();
        if (!health.healthy) {
          await this.updateTemplateValidationResult(input.templateId, {
            status: 'failed',
            reason: `系统自动校验失败：${health.message || '接口健康检查未通过'}`,
            checkedAt: new Date().toISOString(),
            checkedMode: 'system_preflight',
            latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
          });
          return;
        }

        const safeCompletionKind = this.inferSafeAutoValidationCompletionKind(definition);
        if (safeCompletionKind !== 'draft') {
          await this.updateTemplateValidationResult(input.templateId, {
            status: 'blocked',
            reason: '系统已完成接入校验，但当前接口流程未明确标记为草稿/保存待发安全终态，未自动发起真实提交验证。',
            checkedAt: new Date().toISOString(),
            checkedMode: 'system_preflight',
            latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
          });
          return;
        }

        const preparedPayload = this.resolveAutoValidationFormData(definition);
        if (preparedPayload.missingRequiredFields.length > 0) {
          await this.updateTemplateValidationResult(input.templateId, {
            status: 'blocked',
            reason: `系统已完成接入校验，但缺少可用于自动试跑的测试样例：${preparedPayload.missingRequiredFields.join('、')}`,
            checkedAt: new Date().toISOString(),
            checkedMode: 'system_preflight',
            latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
          });
          return;
        }

        const execution = await this.deliveryOrchestrator.submit({
          connectorId: input.connectorId,
          processCode: input.processCode,
          processName: input.processName,
          tenantId: input.tenantId,
          userId: input.userId,
          formData: preparedPayload.formData,
          attachments: preparedPayload.attachments,
          idempotencyKey: `process-library-validation:${input.templateId}:${randomUUID()}`,
        });
        const completionKind = inferSubmissionCompletionKind(execution.submitResult) || safeCompletionKind;
        await this.updateTemplateValidationResult(input.templateId, {
          status: execution.submitResult.success ? 'passed' : 'failed',
          reason: execution.submitResult.success
            ? (completionKind === 'draft'
              ? `系统已自动实测通过，并成功到达保存待发/草稿态${execution.submitResult.submissionId ? `（业务编号：${execution.submitResult.submissionId}）` : ''}。`
              : `系统已自动实测通过，并成功完成提交流程${execution.submitResult.submissionId ? `（业务编号：${execution.submitResult.submissionId}）` : ''}。`)
            : `系统自动试跑失败：${execution.submitResult.errorMessage || '提交未成功'}`,
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_submit_probe',
          latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
        });
      } finally {
        await this.adapterRuntimeService.destroyAdapter(adapter).catch(() => undefined);
      }

      return;
    }

    const adapter = await this.adapterRuntimeService.createRpaAdapterForConnector(
      input.connectorId,
      requestedFlow,
      {
        tenantId: input.tenantId,
        userId: input.userId,
      },
    );

    if (!adapter) {
      await this.updateTemplateValidationResult(input.templateId, {
        status: 'failed',
        reason: '系统自动校验失败：未加载到可执行的页面流程定义',
        checkedAt: new Date().toISOString(),
        checkedMode: 'system_preflight',
      });
      return;
    }

    try {
      const health = await adapter.healthCheck();
      if (!health.healthy) {
        await this.updateTemplateValidationResult(input.templateId, {
          status: 'failed',
          reason: `系统自动校验失败：${health.message || '执行路径装载未通过'}`,
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_preflight',
          latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
        });
        return;
      }

      const safeCompletionKind = this.inferSafeAutoValidationCompletionKind(definition);
      if (safeCompletionKind !== 'draft') {
        await this.updateTemplateValidationResult(input.templateId, {
          status: 'blocked',
          reason: '系统已完成接入校验，但当前流程未明确标记为草稿/保存待发安全终态，未自动发起真实提交验证。',
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_preflight',
          latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
        });
        return;
      }

      const preparedPayload = this.resolveAutoValidationFormData(definition);
      if (preparedPayload.missingRequiredFields.length > 0) {
        await this.updateTemplateValidationResult(input.templateId, {
          status: 'blocked',
          reason: `系统已完成接入校验，但缺少可用于自动试跑的测试样例：${preparedPayload.missingRequiredFields.join('、')}`,
          checkedAt: new Date().toISOString(),
          checkedMode: 'system_preflight',
          latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
        });
        return;
      }

      const execution = await this.deliveryOrchestrator.submit({
        connectorId: input.connectorId,
        processCode: input.processCode,
        processName: input.processName,
        tenantId: input.tenantId,
        userId: input.userId,
        formData: preparedPayload.formData,
        attachments: preparedPayload.attachments,
        idempotencyKey: `process-library-validation:${input.templateId}:${randomUUID()}`,
      });

      const completionKind = inferSubmissionCompletionKind(execution.submitResult) || safeCompletionKind;
      await this.updateTemplateValidationResult(input.templateId, {
        status: execution.submitResult.success ? 'passed' : 'failed',
        reason: execution.submitResult.success
          ? (completionKind === 'draft'
            ? `系统已自动实测通过，并成功到达保存待发/草稿态${execution.submitResult.submissionId ? `（业务编号：${execution.submitResult.submissionId}）` : ''}。`
            : `系统已自动实测通过，并成功完成提交流程${execution.submitResult.submissionId ? `（业务编号：${execution.submitResult.submissionId}）` : ''}。`)
          : `系统自动试跑失败：${execution.submitResult.errorMessage || '提交未成功'}`,
        checkedAt: new Date().toISOString(),
        checkedMode: 'system_submit_probe',
        latencyMs: typeof health.latencyMs === 'number' ? health.latencyMs : undefined,
      });
    } finally {
      await this.adapterRuntimeService.destroyAdapter(adapter).catch(() => undefined);
    }
  }

  private async updateTemplateValidationResult(
    templateId: string,
    patch: {
      status: ProcessValidationStatus;
      reason: string;
      checkedAt?: string;
      checkedMode?: string;
      latencyMs?: number;
    },
  ) {
    const existing = await this.prisma.processTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        uiHints: true,
      },
    });

    if (!existing) {
      return;
    }

    const uiHints = existing.uiHints && typeof existing.uiHints === 'object' && !Array.isArray(existing.uiHints)
      ? { ...(existing.uiHints as Record<string, any>) }
      : {};
    const previousValidation = uiHints.validationResult && typeof uiHints.validationResult === 'object' && !Array.isArray(uiHints.validationResult)
      ? uiHints.validationResult as Record<string, any>
      : {};

    await this.prisma.processTemplate.update({
      where: { id: templateId },
      data: {
        uiHints: {
          ...uiHints,
          validationResult: {
            ...previousValidation,
            status: patch.status,
            reason: patch.reason,
            ...(patch.checkedAt ? { checkedAt: patch.checkedAt } : {}),
            ...(patch.checkedMode ? { checkedMode: patch.checkedMode } : {}),
            ...(typeof patch.latencyMs === 'number' ? { latencyMs: patch.latencyMs } : {}),
          },
        } as Prisma.InputJsonValue,
      },
    });
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

  private evaluateAutoValidationAuthReadiness(
    authConfig: Record<string, any> | null | undefined,
    definition: Record<string, any> | null | undefined,
  ) {
    const config = authConfig && typeof authConfig === 'object' && !Array.isArray(authConfig)
      ? authConfig
      : {};
    const platformConfig = config.platformConfig && typeof config.platformConfig === 'object' && !Array.isArray(config.platformConfig)
      ? config.platformConfig as Record<string, any>
      : {};
    const storageState = platformConfig.storageState && typeof platformConfig.storageState === 'object' && !Array.isArray(platformConfig.storageState)
      ? platformConfig.storageState as Record<string, any>
      : {};

    const hasReusableSession = Boolean(
      (typeof config.cookie === 'string' && config.cookie.trim())
      || (typeof config.sessionCookie === 'string' && config.sessionCookie.trim())
      || (Array.isArray(storageState.cookies) && storageState.cookies.length > 0)
      || (Array.isArray(platformConfig.cookies) && platformConfig.cookies.length > 0)
    );
    if (hasReusableSession) {
      return {
        ready: true,
      };
    }

    const backendLogin = this.pickFirstRecord([
      platformConfig.oaBackendLogin,
      platformConfig.backendLogin,
      platformConfig.whiteListLogin,
      platformConfig.whitelistLogin,
      config.oaBackendLogin,
      config.backendLogin,
      config.whiteListLogin,
      config.whitelistLogin,
    ]);
    if (backendLogin && backendLogin.enabled !== false) {
      return {
        ready: true,
      };
    }

    const runtime = definition?.runtime && typeof definition.runtime === 'object' && !Array.isArray(definition.runtime)
      ? definition.runtime as Record<string, any>
      : {};
    const usesSessionBoundExecution = Boolean(
      runtime.preflight
      || runtime.networkSubmit
      || runtime.networkStatus,
    );
    if (!usesSessionBoundExecution) {
      return {
        ready: true,
      };
    }

    return {
      ready: false,
      reason: '系统已完成流程解析，但当前连接器缺少可复用登录态或后端登录配置，无法自动实测。请先完成该业务系统的认证绑定或配置可复用登录能力后再试。',
    };
  }

  private pickFirstRecord(values: unknown[]) {
    for (const value of values) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
      }
    }
    return null;
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

  private async getManageableConnector(tenantId: string, connectorId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
        bootstrapJobs: {
          some: {},
        },
      },
      select: {
        id: true,
        name: true,
        identityScope: true,
        oaType: true,
        baseUrl: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('所属连接器不存在');
    }

    return connector;
  }

  private async buildManualTemplatePayload(
    dto: CreateProcessTemplateDto,
    connector: {
      id: string;
      name: string;
      identityScope: string | null;
      oaType: string;
      baseUrl: string | null;
    },
  ): Promise<ManualProcessTemplatePayload> {
    const processCodeHint = this.normalizeProcessCode(String(dto.processCode || ''));
    const processNameHint = String(dto.processName || '').trim() || undefined;

    const hintedDefinitions = parseRpaFlowDefinitions(dto.rpaFlowContent);
    const resolvedAccessMode = dto.accessMode === 'rpa' || dto.accessMode === 'url' || dto.accessMode === 'api'
      ? dto.accessMode
      : (hintedDefinitions.some((definition) => this.isDirectLinkDefinition(definition as Record<string, any>)) ? 'url' : 'rpa');
    const resolvedAuthoringMode = dto.authoringMode === 'json' ? 'json' : 'text';
    const resolvedInputMethod: ProcessLibraryInputMethod = dto.inputMethod === 'file' ? 'file' : 'manual';
    const parsed = await this.parseManualProcessLibraryFlowDefinitions({
      content: dto.rpaFlowContent,
      accessMode: resolvedAccessMode,
      authoringMode: resolvedAuthoringMode,
      connectorBaseUrl: connector.baseUrl,
      processName: processNameHint,
      processCode: processCodeHint,
      connectorName: connector.name,
    });

    if (parsed.definitions.length !== 1) {
      throw new BadRequestException('单个添加流程只能提交一个流程定义');
    }

    const baseDefinition = parsed.definitions[0];
    const processName = String(processNameHint || baseDefinition.processName || '').trim();
    if (!processName) {
      throw new BadRequestException('未从模板正文中识别出流程名称，请在模板里填写“流程: 流程名称”');
    }

    const processCode = this.deriveProcessCode({
      explicitCode: String(processCodeHint || baseDefinition.processCode || '').trim(),
      processName,
    });
    const processCategory = dto.processCategory?.trim() || baseDefinition.category || null;
    const description = dto.description?.trim()
      || String(baseDefinition.description || '').trim()
      || null;

    const definition = {
      ...baseDefinition,
      processCode,
      processName,
      ...(processCategory ? { category: processCategory } : {}),
      ...(description ? { description } : {}),
    } as Record<string, any>;

    const parsedApiTools = 'apiTools' in parsed && Array.isArray(parsed.apiTools)
      ? parsed.apiTools
      : [];
    const directLinkDefinition = this.isDirectLinkDefinition(definition);
    const submitSteps = definition.actions?.submit?.steps;
    const hasApiSubmit = resolvedAccessMode === 'api'
      && parsedApiTools.some((tool) => tool.category === 'submit');
    const hasApiQuery = resolvedAccessMode === 'api'
      && parsedApiTools.some((tool) => tool.category === 'query');
    const hasRpaSubmit = resolvedAccessMode !== 'api'
      && !directLinkDefinition
      && Array.isArray(submitSteps)
      && submitSteps.length > 0;
    const hasUrlSubmit = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkSubmit);
    if (!hasApiSubmit && !hasRpaSubmit && !hasUrlSubmit) {
      throw new BadRequestException(
        resolvedAccessMode === 'api'
          ? 'API 流程至少需要提供一个提交接口'
          : directLinkDefinition
          ? '链接直达流程定义必须包含网络提交定义'
          : '流程定义必须包含可执行的提交步骤',
      );
    }

    const hasRpaQuery = resolvedAccessMode !== 'api'
      && !directLinkDefinition
      && Array.isArray(definition.actions?.queryStatus?.steps)
      && definition.actions.queryStatus.steps.length > 0;
    const hasUrlQuery = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkStatus);

    const schemaFields = (definition.fields || []).map((field: any, index: number) => ({
      key: String(field?.key || '').trim() || `field_${index + 1}`,
      label: String(field?.label || field?.key || `字段${index + 1}`).trim(),
      type: String(field?.type || 'text').trim() || 'text',
      required: Boolean(field?.required),
      defaultValue: field?.defaultValue,
      options: Array.isArray(field?.options)
        ? field.options.map((option: any) => {
            if (typeof option === 'string') {
              const normalized = option.trim();
              return normalized
                ? {
                    label: normalized,
                    value: normalized,
                  }
                : null;
            }

            const label = String(option?.label || option?.value || '').trim();
            const value = String(option?.value || option?.label || '').trim();
            return label && value
              ? { label, value }
              : null;
          }).filter(Boolean)
        : undefined,
      validation: Array.isArray(field?.validation) ? field.validation : undefined,
      description: typeof field?.description === 'string' ? field.description.trim() : undefined,
      example: typeof field?.example === 'string' ? field.example.trim() : undefined,
      multiple: field?.multiple === true,
      uiHints: field?.uiHints && typeof field.uiHints === 'object' && !Array.isArray(field.uiHints)
        ? field.uiHints
        : undefined,
    }));

    const sourceHash = createHash('sha256')
      .update(JSON.stringify(definition))
      .digest('hex');

    return {
      connectorId: dto.connectorId,
      processCode,
      processName,
      processCategory,
      description,
      falLevel: dto.falLevel || 'F2',
      accessMode: resolvedAccessMode === 'api'
        ? 'api'
        : (directLinkDefinition ? 'url' : 'rpa'),
      authoringMode: parsed.normalizedAuthoringMode,
      inputMethod: resolvedInputMethod,
      authoringText: parsed.authoringText
        ? this.syncAuthoringTextTemplate(parsed.authoringText, {
            processName,
            processCode,
            description,
            persistProcessCode: this.templateContainsProcessCodeLine(parsed.authoringText) || Boolean(processCodeHint),
          })
        : null,
      definition,
      apiTools: parsedApiTools,
      schemaFields,
      sourceHash,
      hasApiSubmit,
      hasApiQuery,
      hasUrlSubmit,
      hasUrlQuery,
      hasRpaSubmit,
      hasRpaQuery,
    };
  }

  private async parseManualProcessLibraryFlowDefinitions(input: {
    content: string;
    accessMode: ProcessLibraryAccessMode;
    authoringMode: ProcessLibraryAuthoringMode;
    connectorBaseUrl?: string | null;
    processName?: string;
    processCode?: string;
    connectorName?: string | null;
  }): Promise<{
    definitions: Record<string, any>[];
    normalizedAuthoringMode: ProcessLibraryAuthoringMode;
    authoringText?: string;
    apiTools?: ProcessLibraryApiToolDefinition[];
  }> {
    const content = String(input.content || '').trim();
    const parsedDefinitions = parseRpaFlowDefinitions(content);
    const canTryLlm = parsedDefinitions.length === 0
      && input.authoringMode !== 'json'
      && input.accessMode !== 'api';

    if (canTryLlm) {
      try {
        return buildProcessLibraryFlowDefinitions({
          content,
          accessMode: input.accessMode,
          authoringMode: input.authoringMode,
          connectorBaseUrl: input.connectorBaseUrl,
          processName: input.processName,
          processCode: input.processCode,
        });
      } catch {
        // Fall through to LLM only when the deterministic structured-template parser
        // cannot understand the provided text.
      }

      const parsedDocument = await this.tryBuildTextGuideFlowBundleWithLlm(content, {
        connectorName: input.connectorName || input.processName,
        oaUrl: input.connectorBaseUrl || undefined,
      });
      if (parsedDocument) {
        const bundle = buildPageAutomationFlowBundleFromStructuredGuideDocument({
          parsedDocument,
          accessMode: input.accessMode as 'rpa' | 'url',
          connectorBaseUrl: input.connectorBaseUrl,
          processName: input.processName,
          processCode: input.processCode,
        });

        return {
          definitions: bundle.flows || [],
          normalizedAuthoringMode: 'text' as const,
          authoringText: content,
        };
      }
    }

    return buildProcessLibraryFlowDefinitions({
      content,
      accessMode: input.accessMode,
      authoringMode: input.authoringMode,
      connectorBaseUrl: input.connectorBaseUrl,
      processName: input.processName,
      processCode: input.processCode,
    });
  }

  private async tryBuildTextGuideFlowBundleWithLlm(
    guideText: string,
    input: {
      connectorName?: string;
      oaUrl?: string;
    },
  ): Promise<StructuredGuideDocument | null> {
    try {
      const parsedDocument = await this.textGuideLlmParserService.parse({
        guideText,
        connectorName: input.connectorName,
        oaUrl: input.oaUrl,
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
    } catch {
      return null;
    }
  }

  private syncAuthoringTextTemplate(
    source: string,
    input: {
      processName: string;
      processCode: string;
      description: string | null;
      persistProcessCode?: boolean;
    },
  ) {
    const lines = String(source || '').split(/\r?\n/);
    const nextLines = [...lines];

    const replaceOrInsert = (pattern: RegExp, value: string, insertIndex: number) => {
      const index = nextLines.findIndex((line) => pattern.test(String(line || '').trim()));
      if (index >= 0) {
        nextLines[index] = value;
        return;
      }
      nextLines.splice(insertIndex, 0, value);
    };

    replaceOrInsert(/^(?:#{1,6}\s*)?流程\s*(?:[:：]|\s+)/u, `流程: ${input.processName}`, 0);

    const flowLineIndex = nextLines.findIndex((line) => /^(?:#{1,6}\s*)?流程\s*(?:[:：]|\s+)/u.test(String(line || '').trim()));
    const processCodeLineIndex = nextLines.findIndex((line) => /^(?:流程编码|processCode)\s*[:：]/iu.test(String(line || '').trim()));
    if (processCodeLineIndex >= 0) {
      nextLines[processCodeLineIndex] = `流程编码: ${input.processCode}`;
    } else if (input.persistProcessCode) {
      nextLines.splice(flowLineIndex >= 0 ? flowLineIndex + 1 : 1, 0, `流程编码: ${input.processCode}`);
    }

    const descriptionIndex = nextLines.findIndex((line) => /^(?:描述|说明|简介|流程描述|description)\s*[:：]/iu.test(String(line || '').trim()));
    if (input.description) {
      const normalizedDescription = `描述: ${input.description}`;
      if (descriptionIndex >= 0) {
        nextLines[descriptionIndex] = normalizedDescription;
      } else {
        const processCodeIndex = nextLines.findIndex((line) => /^(?:流程编码|processCode)\s*[:：]/iu.test(String(line || '').trim()));
        nextLines.splice(processCodeIndex >= 0 ? processCodeIndex + 1 : 2, 0, normalizedDescription);
      }
    } else if (descriptionIndex >= 0) {
      nextLines.splice(descriptionIndex, 1);
    }

    return nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private async publishManualProcessTemplate(
    tenantId: string,
    connector: {
      id: string;
      name: string;
      identityScope: string | null;
      oaType: string;
      baseUrl: string | null;
    },
    payload: ManualProcessTemplatePayload,
    expectedSupersedesId?: string,
    actor?: ProcessLibraryMutationActor,
  ) {
    const template = await this.prisma.$transaction(async (tx) => {
      const latestTemplate = await tx.processTemplate.findFirst({
        where: {
          tenantId,
          connectorId: connector.id,
          processCode: payload.processCode,
        },
        orderBy: {
          version: 'desc',
        },
      });

      if (expectedSupersedesId && latestTemplate && latestTemplate.id !== expectedSupersedesId) {
        throw new BadRequestException('当前流程已有更新版本，请刷新后重试');
      }

      const remoteProcess = await tx.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId: connector.id,
            remoteProcessId: payload.processCode,
          },
        },
        create: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: payload.processCode,
          remoteProcessCode: payload.processCode,
          remoteProcessName: payload.processName,
          processCategory: payload.processCategory,
          sourceHash: payload.sourceHash,
          sourceVersion: '1',
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description: payload.description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
        update: {
          remoteProcessCode: payload.processCode,
          remoteProcessName: payload.processName,
          processCategory: payload.processCategory,
          sourceHash: payload.sourceHash,
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description: payload.description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
      });

      await this.syncManualApiTools(tx, {
        tenantId,
        connectorId: connector.id,
        processCode: payload.processCode,
        schemaFields: payload.schemaFields,
        apiTools: payload.accessMode === 'api' ? payload.apiTools : [],
      });

      const nextVersion = (latestTemplate?.version || 0) + 1;
      const submitModes = payload.hasApiSubmit
        ? ['api']
        : (payload.hasUrlSubmit ? ['url'] : (payload.hasRpaSubmit ? ['vision'] : []));
      const queryModes = payload.hasApiQuery
        ? ['api']
        : (payload.hasUrlQuery ? ['url'] : (payload.hasRpaQuery ? ['vision'] : []));
      const primaryApiTool = payload.apiTools.find((tool) => tool.category === 'submit');
      const runtimeManifest = buildProcessRuntimeManifest({
        submitPaths: submitModes,
        queryStatusPaths: queryModes,
        definition: payload.definition as any,
        endpoints: payload.apiTools.map((tool) => ({
          path: tool.apiEndpoint,
          method: tool.httpMethod,
          category: tool.category,
        })),
      });
      const legacyExecutionModes = toLegacyExecutionModesFromRuntimeManifest(runtimeManifest);
      const uiHints = {
        runtimeManifest,
        executionModes: legacyExecutionModes,
        rpaDefinition: payload.definition,
        source: 'process_library_manual',
        ...(primaryApiTool
          ? {
              apiMethod: primaryApiTool.httpMethod,
              apiPath: primaryApiTool.apiEndpoint,
              endpoints: this.buildApiUiHintsEndpoints(payload.apiTools),
            }
          : {}),
        authoring: {
          mode: payload.authoringMode,
          accessMode: payload.accessMode,
          inputMethod: payload.inputMethod,
          textTemplate: payload.authoringText,
        },
        validationResult: {
          status: 'running',
          reason: '系统正在自动校验该流程的接入链路，请稍候。',
          checkedMode: 'system_preflight',
        },
      } as unknown as Prisma.InputJsonValue;

      const template = await tx.processTemplate.create({
        data: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: remoteProcess.id,
          processCode: payload.processCode,
          processName: payload.processName,
          processCategory: payload.processCategory,
          description: payload.description,
          version: nextVersion,
          status: 'published',
          falLevel: payload.falLevel,
          sourceHash: payload.sourceHash,
          sourceVersion: String(nextVersion),
          supersedesId: latestTemplate?.id,
          schema: {
            fields: payload.schemaFields,
          },
          rules: null,
          permissions: null,
          uiHints,
          lastSyncedAt: new Date(),
          publishedAt: new Date(),
        },
        include: {
          connector: {
            select: {
              id: true,
              name: true,
              oaType: true,
              oclLevel: true,
            },
          },
        },
      });

      await tx.processTemplate.updateMany({
        where: {
          tenantId,
          connectorId: connector.id,
          processCode: payload.processCode,
          status: 'published',
          NOT: { id: template.id },
        },
        data: {
          status: 'archived',
        },
      });

      await tx.remoteProcess.update({
        where: { id: remoteProcess.id },
        data: {
          latestTemplateId: template.id,
          sourceVersion: String(template.version),
        },
      });

      return template;
    });

    this.scheduleAutoValidation({
      tenantId,
      templateId: template.id,
      connectorId: connector.id,
      processCode: payload.processCode,
      processName: payload.processName,
      accessMode: payload.accessMode,
      userId: actor?.userId,
    });

    return template;
  }

  private async syncManualApiTools(
    tx: any,
    input: {
      tenantId: string;
      connectorId: string;
      processCode: string;
      schemaFields: ManualProcessTemplatePayload['schemaFields'];
      apiTools: ProcessLibraryApiToolDefinition[];
    },
  ) {
    if (!tx?.mCPTool) {
      return;
    }

    const expectedToolNames = input.apiTools.map((tool) => tool.toolName);
    for (const tool of input.apiTools) {
      await tx.mCPTool.upsert({
        where: {
          connectorId_toolName: {
            connectorId: input.connectorId,
            toolName: tool.toolName,
          },
        },
        create: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          toolName: tool.toolName,
          toolDescription: tool.toolDescription,
          toolSchema: this.buildManualApiToolSchema(input.schemaFields, tool.category),
          apiEndpoint: tool.apiEndpoint,
          httpMethod: tool.httpMethod,
          headers: tool.headers || {},
          bodyTemplate: tool.bodyTemplate || null,
          paramMapping: tool.paramMapping,
          responseMapping: tool.responseMapping,
          flowCode: input.processCode,
          category: tool.category,
          enabled: true,
          testInput: tool.testInput || null,
          testOutput: null,
        },
        update: {
          toolDescription: tool.toolDescription,
          toolSchema: this.buildManualApiToolSchema(input.schemaFields, tool.category),
          apiEndpoint: tool.apiEndpoint,
          httpMethod: tool.httpMethod,
          headers: tool.headers || {},
          bodyTemplate: tool.bodyTemplate || null,
          paramMapping: tool.paramMapping,
          responseMapping: tool.responseMapping,
          flowCode: input.processCode,
          category: tool.category,
          enabled: true,
          testInput: tool.testInput || null,
          updatedAt: new Date(),
        },
      });
    }

    if (tx.mCPTool.updateMany) {
      await tx.mCPTool.updateMany({
        where: {
          connectorId: input.connectorId,
          flowCode: input.processCode,
          toolName: {
            startsWith: `manual_${input.processCode}_`,
          },
          ...(expectedToolNames.length > 0
            ? {
                NOT: {
                  toolName: {
                    in: expectedToolNames,
                  },
                },
              }
            : {}),
        },
        data: {
          enabled: false,
        },
      });
    }
  }

  private buildManualApiToolSchema(
    schemaFields: ManualProcessTemplatePayload['schemaFields'],
    category: ProcessLibraryApiToolDefinition['category'],
  ) {
    if (category === 'query') {
      return {
        type: 'object',
        properties: {
          submissionId: {
            type: 'string',
            description: '业务系统中的申请单号或提交流水号',
          },
        },
        required: ['submissionId'],
      };
    }

    return {
      type: 'object',
      properties: Object.fromEntries(schemaFields.map((field) => [
        field.key,
        {
          type: field.type === 'number' ? 'number' : 'string',
          description: field.label,
        },
      ])),
      required: schemaFields.filter((field) => field.required).map((field) => field.key),
    };
  }

  private buildApiUiHintsEndpoints(apiTools: ProcessLibraryApiToolDefinition[]) {
    return apiTools.map((tool) => ({
      toolName: tool.toolName,
      category: tool.category === 'query' ? 'query' : 'submit',
      method: tool.httpMethod,
      path: tool.apiEndpoint,
    }));
  }
}
