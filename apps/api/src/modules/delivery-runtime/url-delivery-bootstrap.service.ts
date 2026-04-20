import { Injectable } from '@nestjs/common';
import { URL_DELIVERY_PATH } from '@uniflow/shared-types';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { PlatformTicketBroker } from '../adapter-runtime/platform-ticket-broker';
import { OaBackendLoginService } from '../adapter-runtime/oa-backend-login.service';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';
import { UrlPortalSsoBridgeService } from './url-portal-sso-bridge.service';

@Injectable()
export class UrlDeliveryBootstrapService {
  private readonly ticketBroker = new PlatformTicketBroker();

  constructor(
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly urlPortalSsoBridgeService: UrlPortalSsoBridgeService,
    private readonly oaBackendLoginService: OaBackendLoginService,
  ) {}

  async prepare(input: {
    action: 'submit' | 'queryStatus';
    connectorId: string;
    processCode: string;
    processName: string;
    tenantId?: string;
    userId?: string;
    uiHints?: Record<string, any>;
  }): Promise<UrlDeliveryExecutionContext> {
    const connector = await this.adapterRuntimeService.getConnectorWithSecrets(input.connectorId);
    let authConfig = await this.adapterRuntimeService.resolveAuthConfigForExecution(connector, {
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const [loadedRpaFlow] = await this.adapterRuntimeService.loadRpaFlowsForConnector(
      input.connectorId,
      [{ flowCode: input.processCode, flowName: input.processName }],
    );
    const rpaFlow = loadedRpaFlow?.rpaDefinition
      ? {
          ...loadedRpaFlow,
          rpaDefinition: this.enrichFlowDefinitionForExecution(loadedRpaFlow.rpaDefinition, authConfig),
        }
      : loadedRpaFlow;
    const definition = rpaFlow?.rpaDefinition;
    authConfig = await this.refreshBackendLoginIfNeeded({
      connector,
      authConfig,
      flow: definition,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const rawTicket = definition
      ? await this.ticketBroker.issueTicket({
          connectorId: input.connectorId,
          processCode: input.processCode,
          action: input.action,
          authConfig,
          flow: definition,
        })
      : { metadata: { source: 'missing_rpa_flow' } };
    const bridgeResult = definition
      ? await this.urlPortalSsoBridgeService.resolve({
          connectorId: input.connectorId,
          processCode: input.processCode,
          processName: input.processName,
          action: input.action,
          authConfig,
          flow: definition,
          ticket: rawTicket,
        })
      : {
          authConfig,
          ticket: rawTicket,
        };

    return {
      path: URL_DELIVERY_PATH,
      action: input.action,
      authConfig: bridgeResult.authConfig,
      rpaFlow,
      ticket: bridgeResult.ticket,
      runtime: {
        ...(definition?.runtime || {}),
      },
      navigation: {
        entryUrl: definition?.platform?.entryUrl,
        jumpUrlTemplate: definition?.platform?.jumpUrlTemplate,
        ticketBrokerUrl: definition?.platform?.ticketBrokerUrl,
        portalUrl: definition?.platform?.portalSsoBridge?.portalUrl,
      },
    };
  }

  private async refreshBackendLoginIfNeeded(input: {
    connector: {
      id?: string;
      authType: string;
    };
    authConfig: Record<string, any>;
    flow?: any;
    tenantId?: string;
    userId?: string;
  }) {
    if (!this.shouldRefreshBackendLogin(input.authConfig, input.flow)) {
      return input.authConfig;
    }

    const resolved = await this.oaBackendLoginService.resolveExecutionAuthConfig({
      connectorId: String(input.connector.id || ''),
      authType: input.connector.authType,
      authConfig: input.authConfig,
      authScope: {
        tenantId: input.tenantId,
        userId: input.userId,
      },
      flow: input.flow,
    });

    if (!resolved?.authConfig) {
      return input.authConfig;
    }

    return this.mergeAuthConfig(input.authConfig, resolved.authConfig);
  }

  private shouldRefreshBackendLogin(authConfig: Record<string, any>, flow?: any) {
    const platformConfig = this.asRecord(authConfig.platformConfig);
    const backendLogin = this.firstRecord([
      platformConfig.oaBackendLogin,
      platformConfig.backendLogin,
      platformConfig.whiteListLogin,
      platformConfig.whitelistLogin,
    ]);
    if (!backendLogin || backendLogin.enabled === false) {
      return false;
    }

    const runtime = this.asRecord(flow?.runtime);
    const portalBridge = this.asRecord(flow?.platform?.portalSsoBridge);
    const requiresSessionBootstrap = Boolean(
      portalBridge.enabled
      || runtime.preflight
      || runtime.networkSubmit
      || runtime.networkStatus,
    );
    if (!requiresSessionBootstrap) {
      return false;
    }

    return backendLogin.refreshOnExecute !== false;
  }

  private mergeAuthConfig(base: Record<string, any>, patch: Record<string, any>) {
    return {
      ...base,
      ...patch,
      platformConfig: {
        ...this.asRecord(base.platformConfig),
        ...this.asRecord(patch.platformConfig),
      },
    };
  }

  private enrichFlowDefinitionForExecution(flow: any, authConfig: Record<string, any>) {
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
      return flow;
    }

    const platform = this.asRecord(flow.platform);
    let nextFlow = this.normalizeLegacyUrlRuntime(flow);

    if (platform.portalSsoBridge && typeof platform.portalSsoBridge === 'object') {
      return nextFlow;
    }

    const nextPlatform = this.asRecord(nextFlow.platform);
    const runtime = this.asRecord(nextFlow.runtime);
    const requiresSessionBootstrap = Boolean(
      runtime.preflight
      || runtime.networkSubmit
      || runtime.networkStatus,
    );
    if (!requiresSessionBootstrap) {
      return nextFlow;
    }

    const platformConfig = this.asRecord(authConfig.platformConfig);
    const portalUrl = this.normalizeUrl(
      platformConfig.entryUrl
      || nextPlatform.entryUrl
      || platformConfig.portalUrl,
    );
    const targetBaseUrl = this.normalizeUrl(
      nextPlatform.businessBaseUrl
      || nextPlatform.targetBaseUrl
      || nextPlatform.targetSystem,
    );

    if (!portalUrl || !targetBaseUrl || this.sameOrigin(portalUrl, targetBaseUrl)) {
      return nextFlow;
    }

    const mergedPlatform = {
      ...nextPlatform,
      portalSsoBridge: {
        enabled: true,
        mode: 'oa_info' as const,
        portalUrl,
        oaInfoUrl: '/gate/lobby/api/oa/info',
        sourcePath: 'coordinateUrl',
        required: true,
      },
    };

    return {
      ...nextFlow,
      platform: mergedPlatform,
    };
  }

  private normalizeLegacyUrlRuntime(flow: any) {
    const runtime = this.asRecord(flow?.runtime);
    const preflight = this.asRecord(runtime.preflight);
    const rawSteps = Array.isArray(preflight.steps) ? preflight.steps : null;
    const fields = Array.isArray(flow?.fields)
      ? flow.fields.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : [];

    if (!rawSteps || fields.length === 0) {
      return flow;
    }

    const textFields = fields.filter((field) => this.normalizeString(field.type)?.toLowerCase() !== 'file');
    const fileFields = fields.filter((field) => this.normalizeString(field.type)?.toLowerCase() === 'file');
    let stepsChanged = false;

    const nextSteps = rawSteps.map((rawStep) => {
      if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
        return rawStep;
      }
      if (this.normalizeString(rawStep.builtin) !== 'capture_form_submit') {
        return rawStep;
      }

      const options = this.asRecord(rawStep.options);
      const normalizedFieldMappings = this.normalizeCaptureMappings(
        Array.isArray(options.fieldMappings) ? options.fieldMappings : [],
        textFields,
      );
      const normalizedFileMappings = this.normalizeCaptureMappings(
        Array.isArray(options.fileMappings) ? options.fileMappings : [],
        fileFields,
      );

      const fieldMappingsChanged = JSON.stringify(normalizedFieldMappings) !== JSON.stringify(options.fieldMappings || []);
      const fileMappingsChanged = JSON.stringify(normalizedFileMappings) !== JSON.stringify(options.fileMappings || []);
      if (!fieldMappingsChanged && !fileMappingsChanged) {
        return rawStep;
      }

      stepsChanged = true;
      return {
        ...rawStep,
        options: {
          ...options,
          fieldMappings: normalizedFieldMappings,
          fileMappings: normalizedFileMappings,
        },
      };
    });

    if (!stepsChanged) {
      return flow;
    }

    return {
      ...flow,
      runtime: {
        ...runtime,
        preflight: {
          ...preflight,
          steps: nextSteps,
        },
      },
    };
  }

  private normalizeCaptureMappings(
    rawMappings: any[],
    fields: Array<Record<string, any>>,
  ) {
    const usedFieldKeys = new Set<string>();
    return rawMappings.map((mapping, index) => {
      const base = this.asRecord(mapping);
      const matchedField = this.matchFieldForCaptureMapping(base, fields, usedFieldKeys, index);
      if (!matchedField) {
        return mapping;
      }

      const matchedKey = this.normalizeString(matchedField.key);
      if (matchedKey) {
        usedFieldKeys.add(matchedKey);
      }

      return this.mergeCaptureMapping(base, matchedField);
    });
  }

  private matchFieldForCaptureMapping(
    mapping: Record<string, any>,
    fields: Array<Record<string, any>>,
    usedFieldKeys: Set<string>,
    index: number,
  ) {
    const explicitKey = this.normalizeString(mapping.fieldKey);
    if (explicitKey) {
      const exactField = fields.find((field) => this.normalizeString(field.key) === explicitKey);
      if (exactField) {
        return exactField;
      }
    }

    const target = this.asRecord(mapping.target);
    const expectedId = this.normalizeString(target.id);
    const expectedName = this.normalizeString(target.name);
    const expectedLabel = this.normalizeString(target.label || target.text || target.placeholder);
    const expectedSelector = this.normalizeString(target.selector);

    const matchedByMetadata = fields.find((field) => {
      const fieldId = this.normalizeString(field.id);
      const fieldName = this.normalizeString(field.name || field.requestFieldName);
      const fieldLabel = this.normalizeString(field.label);
      const fieldSelector = this.normalizeString(field.selector);
      if (expectedId && fieldId && expectedId === fieldId) {
        return true;
      }
      if (expectedName && fieldName && expectedName === fieldName) {
        return true;
      }
      if (expectedLabel && fieldLabel && expectedLabel === fieldLabel) {
        return true;
      }
      if (expectedSelector && fieldSelector && expectedSelector === fieldSelector) {
        return true;
      }
      return false;
    });
    if (matchedByMetadata) {
      return matchedByMetadata;
    }

    return fields.find((field, fieldIndex) => {
      const fieldKey = this.normalizeString(field.key);
      if (!fieldKey || usedFieldKeys.has(fieldKey)) {
        return false;
      }
      return fieldIndex === index;
    }) || null;
  }

  private mergeCaptureMapping(
    mapping: Record<string, any>,
    field: Record<string, any>,
  ) {
    const existingSources = [
      ...(Array.isArray(mapping.sources) ? mapping.sources : []),
      mapping.source,
    ].map((item) => this.normalizeString(item)).filter((item): item is string => Boolean(item));
    const fieldSources = [
      field.key,
      field.label,
    ].map((item) => this.normalizeString(item)).filter((item): item is string => Boolean(item));

    const normalizedOptions = Array.isArray(mapping.options) && mapping.options.length > 0
      ? mapping.options
      : this.buildMappingOptionsFromField(field);

    return {
      ...mapping,
      fieldKey: this.normalizeString(mapping.fieldKey) || this.normalizeString(field.key),
      fieldType: this.normalizeString(mapping.fieldType) || this.normalizeString(field.type),
      sources: Array.from(new Set([...fieldSources, ...existingSources])),
      ...(normalizedOptions.length > 0 ? { options: normalizedOptions } : {}),
      target: {
        ...this.asRecord(field),
        ...this.asRecord(mapping.target),
        label: this.normalizeString(this.asRecord(mapping.target).label) || this.normalizeString(field.label),
      },
    };
  }

  private buildMappingOptionsFromField(field: Record<string, any>) {
    if (!Array.isArray(field.options)) {
      return [];
    }

    return field.options
      .map((option) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          return null;
        }
        const label = this.normalizeString(option.label || option.value);
        const value = this.normalizeString(option.value || option.label);
        if (!label || !value) {
          return null;
        }
        return { label, value };
      })
      .filter((option): option is { label: string; value: string } => Boolean(option));
  }

  private firstRecord(values: unknown[]) {
    for (const value of values) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
      }
    }
    return null;
  }

  private normalizeUrl(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    return raw;
  }

  private normalizeString(value: unknown) {
    const raw = String(value ?? '').trim();
    return raw || '';
  }

  private sameOrigin(left: string, right: string) {
    try {
      return new URL(left).origin === new URL(right).origin;
    } catch {
      return left === right;
    }
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }
}
