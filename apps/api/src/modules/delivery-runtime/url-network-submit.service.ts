import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { Injectable, Optional } from '@nestjs/common';
import { sanitizeStructuredData } from '@uniflow/agent-kernel';
import type {
  RpaNetworkMappingRule,
  RpaNetworkRequestDefinition,
} from '@uniflow/shared-types';
import type { StatusResult, SubmitResult } from '@uniflow/oa-adapters';
import { BrowserTaskRuntime } from '../browser-runtime/browser-task-runtime';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';

interface UrlNetworkBaseInput {
  connectorId: string;
  processCode: string;
  processName: string;
  context: UrlDeliveryExecutionContext;
}

interface UrlNetworkSubmitInput extends UrlNetworkBaseInput {
  action: 'submit';
  payload: Record<string, any>;
}

interface UrlNetworkStatusInput extends UrlNetworkBaseInput {
  action: 'queryStatus';
  payload: Record<string, any>;
}

type UrlNetworkExecutionInput = UrlNetworkSubmitInput | UrlNetworkStatusInput;

interface PreflightResult {
  extractedValues: Record<string, any>;
  session?: {
    sessionId: string;
    provider: string;
    requestedProvider: string;
  };
  snapshots?: Array<{ snapshotId: string; title?: string; url?: string }>;
}

@Injectable()
export class UrlNetworkSubmitService {
  private readonly client: AxiosInstance;
  private readonly browserTaskRuntime: BrowserTaskRuntime;

  constructor(
    @Optional()
    browserTaskRuntime?: BrowserTaskRuntime,
    @Optional()
    client?: AxiosInstance,
  ) {
    this.browserTaskRuntime = browserTaskRuntime || new BrowserTaskRuntime();
    this.client = client || axios.create({
      timeout: 30000,
      validateStatus: () => true,
    });
  }

  async execute(input: UrlNetworkExecutionInput): Promise<{
    submitResult?: SubmitResult;
    statusResult?: StatusResult;
    artifactRefs: Array<{ id: string; kind: 'page_snapshot'; summary: string }>;
    summary: string;
  }> {
    const requestDef = input.action === 'submit'
      ? input.context.runtime.networkSubmit
      : input.context.runtime.networkStatus;
    if (!requestDef?.url) {
      throw new Error(`No URL network ${input.action} definition is configured for ${input.processCode}`);
    }

    const preflight = await this.runPreflight(input);
    const requestContext = this.buildRequestContext(input, preflight.extractedValues);
    const request = this.buildHttpRequest(requestDef, requestContext, input.context);
    const response = await this.client.request(request);
    const responseBody = response.data;
    const responseMetadata = this.mapResponse(requestDef, responseBody);
    const success = this.resolveSuccess(input.action, requestDef, response.status, responseMetadata);
    const summary = this.resolveSummary(input, success, responseMetadata.message);
    const artifactRefs = this.toArtifactRefs(preflight.snapshots);
    const metadata = sanitizeStructuredData({
      mode: 'url-network',
      action: input.action,
      completionKind: requestDef?.completionKind || 'submitted',
      connectorId: input.connectorId,
      flowCode: input.processCode,
      jumpUrl: input.context.ticket.jumpUrl,
      request: {
        method: request.method,
        url: request.url,
        completionKind: requestDef?.completionKind || 'submitted',
        query: request.params,
        headers: this.maskHeaders(request.headers),
        body: this.maskBody(request.data),
      },
      response: {
        status: response.status,
        data: responseBody,
      },
      preflight: {
        extractedValues: preflight.extractedValues,
        session: preflight.session,
      },
      deliveryPath: 'url',
    });

    if (input.action === 'submit') {
      return {
        submitResult: {
          success,
          submissionId: responseMetadata.submissionId,
          errorMessage: success ? undefined : (responseMetadata.message || `URL network submit failed with HTTP ${response.status}`),
          metadata,
        } satisfies SubmitResult,
        artifactRefs,
        summary,
      };
    }

    return {
      statusResult: {
        status: success
          ? (responseMetadata.status || 'submitted')
          : 'error',
        statusDetail: success
          ? metadata
          : {
              ...metadata,
              error: responseMetadata.message || `URL network status failed with HTTP ${response.status}`,
            },
        timeline: [],
      } satisfies StatusResult,
      artifactRefs,
      summary,
    };
  }

  private async runPreflight(input: UrlNetworkExecutionInput): Promise<PreflightResult> {
    const action = input.context.runtime.preflight;
    if (!action?.steps?.length) {
      return {
        extractedValues: {},
      };
    }

    const result = await this.browserTaskRuntime.run({
      action: input.action,
      flow: {
        processCode: input.processCode,
        processName: input.processName,
        actions: {
          [input.action]: action,
        },
        platform: input.context.rpaFlow?.rpaDefinition.platform,
        runtime: input.context.rpaFlow?.rpaDefinition.runtime,
      } as any,
      runtime: {
        ...input.context.runtime,
        executorMode: 'browser',
      },
      payload: {
        ...input.payload,
        auth: input.context.authConfig,
      },
      ticket: input.context.ticket,
    });

    if (!result.success) {
      throw new Error(result.errorMessage || 'URL preflight failed');
    }

    return {
      extractedValues: result.extractedValues || {},
      session: {
        sessionId: result.sessionId,
        provider: result.provider,
        requestedProvider: result.requestedProvider,
      },
      snapshots: result.snapshots,
    };
  }

  private buildRequestContext(
    input: UrlNetworkExecutionInput,
    preflightValues: Record<string, any>,
  ) {
    const auth = input.context.authConfig || {};
    const platformConfig = this.asRecord(auth.platformConfig);
    return {
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName,
      jumpUrl: input.context.ticket.jumpUrl,
      ticket: input.context.ticket.ticket,
      ticketHeaders: input.context.ticket.headers || {},
      auth,
      authPlatform: platformConfig,
      formData: input.payload.formData || {},
      payload: input.payload,
      preflight: preflightValues,
      page: preflightValues,
      submissionId: input.payload.submissionId,
    };
  }

  private buildHttpRequest(
    definition: RpaNetworkRequestDefinition,
    context: Record<string, any>,
    deliveryContext: UrlDeliveryExecutionContext,
  ): AxiosRequestConfig {
    const method = String(definition.method || 'POST').toUpperCase();
    const url = this.interpolateTemplate(definition.url, context);
    const params = this.applyMapping(definition.query, context);
    const headers = {
      ...this.normalizeStringMap(deliveryContext.runtime.headers || {}, context),
      ...this.normalizeStringMap(definition.headers || {}, context),
      ...(deliveryContext.ticket.headers || {}),
      ...this.buildSessionHeaders(context.auth, context.authPlatform, url),
    };
    const config: AxiosRequestConfig = {
      method: method as any,
      url,
      params,
      headers,
      timeout: deliveryContext.runtime.timeoutMs || 30000,
      validateStatus: () => true,
    };

    if (!['GET', 'DELETE'].includes(method)) {
      if (definition.bodyMode === 'form') {
        const body = this.buildRequestBody(context, definition.body);
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(this.flattenUndefined(body))) {
          searchParams.set(key, value === undefined || value === null ? '' : String(value));
        }
        config.data = searchParams.toString();
        (config.headers as Record<string, string>)['Content-Type'] =
          (config.headers as Record<string, string>)['Content-Type'] || 'application/x-www-form-urlencoded';
      } else {
        config.data = this.buildRequestBody(context, definition.body);
        (config.headers as Record<string, string>)['Content-Type'] =
          (config.headers as Record<string, string>)['Content-Type'] || 'application/json';
      }
    }

    return config;
  }

  private buildRequestBody(context: Record<string, any>, template: any): any {
    if (template === undefined) {
      return context.formData || {};
    }

    if (typeof template === 'string') {
      return this.interpolateTemplate(template, context);
    }

    if (!template || typeof template !== 'object') {
      return template;
    }

    if (Array.isArray(template)) {
      return template.map((item) => this.buildRequestBody(context, item));
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string') {
        result[key] = this.interpolateTemplate(value, context);
      } else if (this.isMappingRule(value)) {
        result[key] = this.resolveRule(value as RpaNetworkMappingRule, context);
      } else if (value && typeof value === 'object') {
        result[key] = this.buildRequestBody(context, value);
      } else {
        result[key] = value;
      }
    }
    return this.flattenUndefined(result);
  }

  private applyMapping(
    mapping: Record<string, string | RpaNetworkMappingRule> | undefined,
    context: Record<string, any>,
  ) {
    if (!mapping) {
      return undefined;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(mapping)) {
      result[key] = typeof value === 'string'
        ? this.interpolateTemplate(value, context)
        : this.resolveRule(value, context);
    }
    return this.flattenUndefined(result);
  }

  private normalizeStringMap(
    mapping: Record<string, string | RpaNetworkMappingRule>,
    context: Record<string, any>,
  ) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(mapping || {})) {
      const resolved = typeof value === 'string'
        ? this.interpolateTemplate(value, context)
        : this.resolveRule(value, context);
      if (resolved !== undefined && resolved !== null && resolved !== '') {
        result[key] = String(resolved);
      }
    }
    return result;
  }

  private resolveRule(rule: RpaNetworkMappingRule, context: Record<string, any>) {
    let value = rule.source
      ? this.getNestedValue(context, rule.source)
      : undefined;
    if (value === undefined) {
      value = rule.default;
    }

    switch (rule.transform) {
      case 'toString':
        return value === undefined || value === null ? value : String(value);
      case 'toNumber':
        return value === undefined || value === null ? value : Number(value);
      case 'toBoolean':
        return value === undefined || value === null ? value : Boolean(value);
      case 'toUpperCase':
        return value === undefined || value === null ? value : String(value).toUpperCase();
      case 'toLowerCase':
        return value === undefined || value === null ? value : String(value).toLowerCase();
      case 'json':
        return value === undefined ? value : JSON.stringify(value);
      default:
        return value;
    }
  }

  private mapResponse(definition: RpaNetworkRequestDefinition, responseBody: any) {
    const mapping = definition.responseMapping || {};
    return {
      success: mapping.successPath ? this.getNestedValue(responseBody, mapping.successPath) : undefined,
      submissionId: mapping.submissionIdPath ? this.normalizeString(this.getNestedValue(responseBody, mapping.submissionIdPath)) : undefined,
      status: mapping.statusPath ? this.normalizeString(this.getNestedValue(responseBody, mapping.statusPath)) : undefined,
      message: mapping.messagePath ? this.normalizeString(this.getNestedValue(responseBody, mapping.messagePath)) : undefined,
    };
  }

  private resolveSuccess(
    action: 'submit' | 'queryStatus',
    definition: RpaNetworkRequestDefinition,
    statusCode: number,
    responseMetadata: { success?: any; status?: string; message?: string; submissionId?: string },
  ) {
    if (definition.successMode === 'http2xx') {
      return statusCode >= 200 && statusCode < 400;
    }

    if (definition.responseMapping?.successPath) {
      if (definition.responseMapping.successValue !== undefined) {
        return responseMetadata.success === definition.responseMapping.successValue;
      }
      return responseMetadata.success !== false && responseMetadata.success !== undefined;
    }

    if (statusCode < 200 || statusCode >= 400) {
      return false;
    }

    if (action === 'submit') {
      return Boolean(responseMetadata.submissionId);
    }

    return true;
  }

  private resolveSummary(
    input: UrlNetworkExecutionInput,
    success: boolean,
    message?: string,
  ) {
    if (message) {
      return message;
    }
    const requestDef = input.action === 'submit'
      ? input.context.runtime.networkSubmit
      : input.context.runtime.networkStatus;
    if (input.action === 'submit' && requestDef?.completionKind === 'draft') {
      return `${input.processName} ${success ? 'draft saved' : 'draft save failed'} through URL network runtime`;
    }
    return `${input.processName} ${input.action === 'submit' ? 'submitted' : 'status queried'} through URL network runtime${success ? '' : ' with errors'}`;
  }

  private toArtifactRefs(snapshots: Array<{ snapshotId: string; title?: string; url?: string }> | undefined) {
    return (snapshots || []).map((snapshot) => ({
      id: snapshot.snapshotId,
      kind: 'page_snapshot' as const,
      summary: `${snapshot.title || 'Snapshot'} @ ${snapshot.url || 'unknown'}`,
    }));
  }

  private buildSessionHeaders(auth: Record<string, any>, platformConfig: Record<string, any>, targetUrl?: string) {
    const cookieHeader = this.normalizeString(
      auth.sessionCookie
      ?? auth.cookie
      ?? platformConfig.sessionCookie
      ?? platformConfig.cookie,
    );
    if (cookieHeader) {
      return { Cookie: cookieHeader };
    }

    const derivedCookieHeader = this.buildCookieHeaderFromStorageState(
      platformConfig.storageState ?? auth.storageState,
      targetUrl || platformConfig.cookieOrigin,
    );
    return derivedCookieHeader
      ? { Cookie: derivedCookieHeader }
      : {};
  }

  private buildCookieHeaderFromStorageState(storageState: unknown, fallbackUrl?: string) {
    const parsed = this.parseStorageState(storageState);
    const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
    if (cookies.length === 0) {
      return undefined;
    }

    const targetUrl = fallbackUrl || this.normalizeString(parsed?.cookies?.[0]?.url);
    if (!targetUrl) {
      return undefined;
    }

    try {
      const url = new URL(targetUrl);
      const visibleCookies = cookies.filter((cookie) => this.matchesCookie(cookie, url));
      return visibleCookies.length > 0
        ? visibleCookies.map((cookie) => `${cookie.name}=${cookie.value || ''}`).join('; ')
        : undefined;
    } catch {
      return undefined;
    }
  }

  private interpolateTemplate(template: string, context: Record<string, any>) {
    return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath) => {
      const value = this.getNestedValue(context, String(rawPath || '').trim());
      return value === undefined || value === null ? '' : String(value);
    });
  }

  private getNestedValue(value: any, path: string) {
    return path.split('.').reduce((current, key) => current?.[key], value);
  }

  private normalizeString(value: unknown) {
    if (value === null || value === undefined) {
      return undefined;
    }
    const normalized = typeof value === 'string' ? value.trim() : String(value);
    return normalized || undefined;
  }

  private parseStorageState(value: unknown) {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, any>;
  }

  private matchesCookie(cookie: Record<string, any>, url: URL) {
    const cookiePath = String(cookie.path || '/');
    if (!url.pathname.startsWith(cookiePath)) {
      return false;
    }

    if (cookie.url) {
      try {
        return new URL(String(cookie.url)).origin === url.origin;
      } catch {
        return false;
      }
    }

    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  private flattenUndefined(value: any): any {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.flattenUndefined(item));
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, current]) => current !== undefined)
        .map(([key, current]) => [key, this.flattenUndefined(current)]),
    );
  }

  private maskHeaders(headers: any) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers || {})) {
      result[key] = /cookie|authorization/i.test(key)
        ? '***'
        : value;
    }
    return result;
  }

  private maskBody(body: any) {
    if (typeof body === 'string') {
      return body;
    }
    return body;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }

  private isMappingRule(value: unknown) {
    return !!value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (
        Object.prototype.hasOwnProperty.call(value, 'source')
        || Object.prototype.hasOwnProperty.call(value, 'default')
        || Object.prototype.hasOwnProperty.call(value, 'transform')
      );
  }
}
