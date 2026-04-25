import { Injectable } from '@nestjs/common';
import type { ProcessTemplate, Connector } from '@prisma/client';
import {
  type DeliveryCapabilitySummary,
  type DeliveryHealth,
  type DeliveryPath,
  getProcessRuntimeDefinition,
  getProcessRuntimeEndpoints,
  getProcessRuntimePaths,
  resolveProcessRuntimeManifest,
  type RpaFlowDefinition,
} from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';

type TemplateWithConnector = ProcessTemplate & {
  connector?: Connector | null;
};

@Injectable()
export class DeliveryCapabilityRouter {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForTemplateId(templateId: string): Promise<DeliveryCapabilitySummary> {
    const template = await this.prisma.processTemplate.findUnique({
      where: { id: templateId },
      include: { connector: true },
    });
    if (!template) {
      return this.buildUnavailableSummary();
    }
    return this.resolveForTemplateRecord(template);
  }

  resolveForTemplateRecord(template: TemplateWithConnector): DeliveryCapabilitySummary {
    const uiHints = ((template.uiHints as Record<string, any> | null) || {});
    const explicit = uiHints.delivery as Record<string, any> | undefined;
    if (explicit) {
      return this.normalizeSummary(explicit, 'delivery');
    }

    const manifestResolution = resolveProcessRuntimeManifest(uiHints);
    const submitPaths = getProcessRuntimePaths(uiHints, 'submit');
    const queryStatusPaths = getProcessRuntimePaths(uiHints, 'queryStatus');
    const rpaDefinition = getProcessRuntimeDefinition(uiHints) as RpaFlowDefinition | undefined;
    const endpoints = getProcessRuntimeEndpoints(uiHints);
    const runtime = rpaDefinition?.runtime;
    const isDirectLink = this.isDirectLinkDefinition(rpaDefinition);
    const hasApiSubmit = submitPaths.includes('api')
      || endpoints.some((endpoint) => endpoint?.category === 'submit' && String(endpoint?.method || '').toUpperCase() !== 'RPA');
    const hasApiQuery = queryStatusPaths.includes('api')
      || endpoints.some((endpoint) => ['query', 'status_query'].includes(endpoint?.category) && String(endpoint?.method || '').toUpperCase() !== 'RPA');
    const hasRpaSubmit = submitPaths.includes('vision')
      || (!isDirectLink && !!rpaDefinition?.actions?.submit);
    const hasRpaQuery = queryStatusPaths.includes('vision')
      || (!isDirectLink && !!rpaDefinition?.actions?.queryStatus);
    const hasUrlSubmit = submitPaths.includes('url')
      || (isDirectLink && this.hasNetworkRequest(runtime?.networkSubmit));
    const hasUrlQuery = queryStatusPaths.includes('url')
      || (isDirectLink && this.hasNetworkRequest(runtime?.networkStatus));
    const hasVisionTargets = this.hasImageTargets(rpaDefinition);
    const hasUrlEntry = !!(rpaDefinition?.platform?.entryUrl || rpaDefinition?.platform?.jumpUrlTemplate || rpaDefinition?.platform?.ticketBrokerUrl);
    const hasUrlCapability = (hasUrlSubmit || hasUrlQuery)
      && (hasUrlEntry || this.hasNetworkRequest(runtime?.networkSubmit) || this.hasNetworkRequest(runtime?.networkStatus));
    const hasVisionCapability = hasRpaSubmit || hasRpaQuery;

    const apiHealth = this.resolveApiHealth(template.connector, hasApiSubmit || hasApiQuery);
    const urlHealth = this.resolveRpaHealth(hasUrlCapability, hasUrlEntry);
    const visionHealth = this.resolveVisionHealth(hasVisionCapability, hasVisionTargets, uiHints);

    return {
      api: {
        available: hasApiSubmit || hasApiQuery,
        submitEnabled: hasApiSubmit,
        queryEnabled: hasApiQuery,
        health: apiHealth,
        toolNames: [],
      },
      url: {
        available: hasUrlCapability,
        submitEnabled: hasUrlSubmit,
        queryEnabled: hasUrlQuery,
        health: urlHealth,
        entryUrl: rpaDefinition?.platform?.entryUrl,
        jumpUrlTemplate: rpaDefinition?.platform?.jumpUrlTemplate,
        ticketBrokerUrl: rpaDefinition?.platform?.ticketBrokerUrl,
        executorMode: this.resolveUrlExecutorMode(runtime),
      },
      vision: {
        available: hasVisionCapability,
        submitEnabled: hasRpaSubmit,
        queryEnabled: hasRpaQuery,
        health: visionHealth,
        startContext: this.resolveVisionStartContext(rpaDefinition, uiHints),
        templateBundleRef: typeof uiHints.visionTemplateBundleRef === 'string'
          ? uiHints.visionTemplateBundleRef
          : undefined,
        templateCount: this.countVisionTemplates(rpaDefinition),
        ocrReady: Boolean(uiHints.visionOcrReady || hasVisionTargets),
      },
      fallbackOrder: this.resolveFallbackOrder({
        api: { health: apiHealth, available: hasApiSubmit || hasApiQuery },
        url: { health: urlHealth, available: hasUrlCapability },
        vision: { health: visionHealth, available: hasVisionCapability },
      }),
      source: manifestResolution.source === 'runtime_manifest' ? 'runtime_manifest' : 'legacy_ui_hints',
    };
  }

  selectPrimaryPath(
    summary: DeliveryCapabilitySummary,
    intent: 'submit' | 'query_status' = 'submit',
  ): DeliveryPath | null {
    const capabilityKey = intent === 'submit' ? 'submitEnabled' : 'queryEnabled';
    const ordered: DeliveryPath[] = summary.fallbackOrder?.length ? summary.fallbackOrder : ['api', 'url', 'vision'];

    for (const path of ordered) {
      const capability = summary[path];
      if (capability.available && capability[capabilityKey] && capability.health !== 'unavailable') {
        return path;
      }
    }

    return null;
  }

  private normalizeSummary(raw: Record<string, any>, source: DeliveryCapabilitySummary['source']): DeliveryCapabilitySummary {
    const api = raw.api || {};
    const url = raw.url || {};
    const vision = raw.vision || {};
    return {
      api: {
        available: Boolean(api.available),
        submitEnabled: Boolean(api.submitEnabled),
        queryEnabled: Boolean(api.queryEnabled),
        health: this.normalizeHealth(api.health, api.available),
        toolNames: Array.isArray(api.toolNames) ? api.toolNames.filter((item: unknown): item is string => typeof item === 'string') : [],
      },
      url: {
        available: Boolean(url.available),
        submitEnabled: Boolean(url.submitEnabled),
        queryEnabled: Boolean(url.queryEnabled),
        health: this.normalizeHealth(url.health, url.available),
        entryUrl: typeof url.entryUrl === 'string' ? url.entryUrl : undefined,
        jumpUrlTemplate: typeof url.jumpUrlTemplate === 'string' ? url.jumpUrlTemplate : undefined,
        ticketBrokerUrl: typeof url.ticketBrokerUrl === 'string' ? url.ticketBrokerUrl : undefined,
        executorMode: this.normalizeExecutorMode(url.executorMode),
      },
      vision: {
        available: Boolean(vision.available),
        submitEnabled: Boolean(vision.submitEnabled),
        queryEnabled: Boolean(vision.queryEnabled),
        health: this.normalizeHealth(vision.health, vision.available),
        startContext: this.isVisionStartContext(vision.startContext) ? vision.startContext : undefined,
        templateBundleRef: typeof vision.templateBundleRef === 'string' ? vision.templateBundleRef : undefined,
        templateCount: typeof vision.templateCount === 'number' ? vision.templateCount : undefined,
        ocrReady: typeof vision.ocrReady === 'boolean' ? vision.ocrReady : undefined,
      },
      fallbackOrder: Array.isArray(raw.fallbackOrder)
        ? raw.fallbackOrder.filter((item: unknown): item is DeliveryPath => item === 'api' || item === 'url' || item === 'vision')
        : this.resolveFallbackOrder({
            api: { available: Boolean(api.available), health: this.normalizeHealth(api.health, api.available) },
            url: { available: Boolean(url.available), health: this.normalizeHealth(url.health, url.available) },
            vision: { available: Boolean(vision.available), health: this.normalizeHealth(vision.health, vision.available) },
          }),
      source,
    };
  }

  private buildUnavailableSummary(): DeliveryCapabilitySummary {
    return {
      api: { available: false, submitEnabled: false, queryEnabled: false, health: 'unavailable', toolNames: [] },
      url: { available: false, submitEnabled: false, queryEnabled: false, health: 'unavailable' },
      vision: { available: false, submitEnabled: false, queryEnabled: false, health: 'unavailable' },
      fallbackOrder: [],
      source: 'inferred',
    };
  }

  private hasImageTargets(definition?: RpaFlowDefinition) {
    if (!definition) return false;
    const steps = [
      ...(definition.actions?.submit?.steps || []),
      ...(definition.actions?.queryStatus?.steps || []),
    ];
    return steps.some((step) => step.target?.kind === 'image');
  }

  private countVisionTemplates(definition?: RpaFlowDefinition) {
    if (!definition) return 0;
    const steps = [
      ...(definition.actions?.submit?.steps || []),
      ...(definition.actions?.queryStatus?.steps || []),
    ];
    return steps.filter((step) => step.target?.kind === 'image').length;
  }

  private resolveApiHealth(connector: Connector | null | undefined, available: boolean): DeliveryHealth {
    if (!available) return 'unavailable';
    if (!connector || connector.status !== 'active') return 'degraded';
    return 'healthy';
  }

  private resolveRpaHealth(available: boolean, hasEntry: boolean): DeliveryHealth {
    if (!available) return 'unavailable';
    return hasEntry ? 'healthy' : 'degraded';
  }

  private resolveVisionHealth(available: boolean, hasVisionTargets: boolean, uiHints: Record<string, any>): DeliveryHealth {
    if (!available) return 'unavailable';
    if (hasVisionTargets && (uiHints.visionTemplateBundleRef || uiHints.visionOcrReady)) return 'healthy';
    return 'degraded';
  }

  private resolveVisionStartContext(definition: RpaFlowDefinition | undefined, uiHints: Record<string, any>) {
    const configured = uiHints.visionStartContext;
    if (this.isVisionStartContext(configured)) return configured;
    if (definition?.platform?.entryUrl) return 'portal_home';
    return undefined;
  }

  private isVisionStartContext(value: unknown): value is DeliveryCapabilitySummary['vision']['startContext'] {
    return ['portal_home', 'attach_session', 'manual_opened', 'local_app'].includes(String(value));
  }

  private normalizeExecutorMode(value: unknown): DeliveryCapabilitySummary['url']['executorMode'] {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'browser' || normalized === 'local' || normalized === 'http' || normalized === 'stub') {
      return normalized as DeliveryCapabilitySummary['url']['executorMode'];
    }
    return undefined;
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

  private isDirectLinkDefinition(definition?: RpaFlowDefinition) {
    if (!definition || typeof definition !== 'object') {
      return false;
    }

    const raw = definition as Record<string, any>;
    const metadata = raw.metadata && typeof raw.metadata === 'object'
      ? raw.metadata as Record<string, any>
      : {};
    const accessMode = String(raw.accessMode || metadata.accessMode || '').trim().toLowerCase();
    const sourceType = String(raw.sourceType || metadata.sourceType || '').trim().toLowerCase();

    return accessMode === 'direct_link' || sourceType === 'direct_link';
  }

  private resolveUrlExecutorMode(runtime: RpaFlowDefinition['runtime']) {
    const explicit = this.normalizeExecutorMode(runtime?.executorMode);
    if (explicit) {
      return explicit;
    }

    if (this.hasNetworkRequest(runtime?.networkSubmit) || this.hasNetworkRequest(runtime?.networkStatus)) {
      return 'http';
    }

    return undefined;
  }

  private normalizeHealth(value: unknown, available: boolean): DeliveryHealth {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'healthy' || normalized === 'degraded' || normalized === 'unavailable') {
      return normalized;
    }
    return available ? 'healthy' : 'unavailable';
  }

  private resolveFallbackOrder(input: Record<DeliveryPath, { available: boolean; health: DeliveryHealth }>): DeliveryPath[] {
    const preferredOrder: DeliveryPath[] = input.vision.available && input.vision.health !== 'unavailable'
      ? ['api', 'vision', 'url']
      : ['api', 'url', 'vision'];

    return preferredOrder.filter((path) => input[path].available && input[path].health !== 'unavailable');
  }
}
