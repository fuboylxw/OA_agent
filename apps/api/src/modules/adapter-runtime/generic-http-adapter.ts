import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
  OAAdapter,
  DiscoverResult,
  HealthCheckResult,
  SubmitRequest,
  SubmitResult,
  StatusResult,
  ReferenceDataResult,
  CancelResult,
  UrgeResult,
  DelegateRequest,
  DelegateResult,
  SupplementRequest,
  SupplementResult,
} from '@uniflow/oa-adapters';
import type { AdapterLifecycle } from '@uniflow/oa-adapters';
import {
  classifyProbeStatus,
  resolveAssistantFieldPresentation,
  type ProbeStatus,
} from '@uniflow/shared-types';

// ============================================================
// MCPTool 端点定义（从数据库读取后的运行时结构）
// ============================================================

export interface EndpointDef {
  toolName: string;
  category: string; // submit, query, cancel, urge, list, get, other
  apiEndpoint: string;
  httpMethod: string;
  headers?: Record<string, string>;
  bodyTemplate?: any;
  paramMapping: Record<string, any>;
  responseMapping: Record<string, any>;
  flowCode?: string | null;
}

export interface GenericHttpAdapterConfig {
  connectorId: string;
  baseUrl: string;
  authType: string;
  authConfig: Record<string, any>;
  flows?: Array<{ flowCode: string; flowName: string }>;
  oaVendor?: string;
  oaVersion?: string;
  oaType: 'openapi' | 'form-page' | 'hybrid';
  healthCheckUrl?: string;
}

/**
 * 端点加载器接口 —— 解耦数据库依赖，方便测试
 */
export interface EndpointLoader {
  loadEndpoints(connectorId: string): Promise<EndpointDef[]>;
}

const ALLOWED_TRANSFORMS = new Set([
  'toString', 'toNumber', 'toBoolean',
  'toUpperCase', 'toLowerCase', 'toDate', 'toArray',
]);

/**
 * GenericHttpAdapter — 配置驱动的通用 OA 适配器
 *
 * 不写死任何 API 路径。所有端点映射从 MCPTool 表动态加载。
 * 前端初始化中心创建 connector + 上传 API 文档 → 自动生成 MCPTool → 本适配器直接可用。
 *
 * 工作原理：
 *   1. init() 时从数据库加载该 connector 的所有 MCPTool 端点定义
 *   2. 按 category 分类：submit / query / cancel / urge / list
 *   3. OAAdapter 接口方法根据 category 查找对应端点，动态构建 HTTP 请求
 *   4. 参数映射、响应映射、认证注入全部配置化
 */
export class GenericHttpAdapter implements OAAdapter, AdapterLifecycle {
  private client: AxiosInstance;
  private endpoints: EndpointDef[] = [];
  private endpointsByCategory: Map<string, EndpointDef[]> = new Map();
  private endpointsByFlowAndCategory: Map<string, EndpointDef> = new Map();
  private cookieSession?: string;
  private readonly requestedFlowCodes: Set<string>;
  private readonly preferredFlowCode?: string;

  constructor(
    private readonly config: GenericHttpAdapterConfig,
    private readonly endpointLoader: EndpointLoader,
  ) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.requestedFlowCodes = new Set((config.flows || []).map((flow) => flow.flowCode).filter(Boolean));
    this.preferredFlowCode = config.flows?.length === 1 ? config.flows[0].flowCode : undefined;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async init(): Promise<void> {
    const loadedEndpoints = await this.endpointLoader.loadEndpoints(this.config.connectorId);
    this.endpoints = this.requestedFlowCodes.size === 0
      ? loadedEndpoints
      : loadedEndpoints.filter((endpoint) =>
          !endpoint.flowCode || this.requestedFlowCodes.has(endpoint.flowCode),
        );
    this.indexEndpoints();

    // Pre-authenticate for cookie-based auth
    if (this.config.authType === 'cookie') {
      await this.authenticateCookie();
    }
  }

  async destroy(): Promise<void> {
    this.endpoints = [];
    this.endpointsByCategory.clear();
    this.endpointsByFlowAndCategory.clear();
    this.cookieSession = undefined;
  }

  async refreshAuth(): Promise<void> {
    if (this.config.authType === 'cookie') {
      this.cookieSession = undefined;
      await this.authenticateCookie();
      return;
    }

    if (
      (this.config.authType === 'bearer' || this.config.authType === 'oauth2')
      && this.config.authConfig.username
      && this.config.authConfig.password
    ) {
      await this.authenticateToken();
    }
  }

  // ── OAAdapter interface ───────────────────────────────────

  async discover(): Promise<DiscoverResult> {
    // 从已加载的端点中提取 flow 信息
    const flowMap = new Map<string, { flowCode: string; flowName: string; submitUrl?: string; queryUrl?: string }>();

    for (const ep of this.endpoints) {
      if (!ep.flowCode) continue;
      const existing = flowMap.get(ep.flowCode) || {
        flowCode: ep.flowCode,
        flowName: ep.flowCode,
      };

      if (ep.category === 'submit') existing.submitUrl = ep.apiEndpoint;
      if (ep.category === 'query') existing.queryUrl = ep.apiEndpoint;

      flowMap.set(ep.flowCode, existing);
    }

    return {
      oaVendor: this.config.oaVendor || 'Generic',
      oaVersion: this.config.oaVersion,
      oaType: this.config.oaType,
      authType: this.config.authType as any,
      discoveredFlows: [...flowMap.values()],
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const url = this.config.healthCheckUrl || '/';
      const response = await this.client.get(url, {
        timeout: 5000,
        validateStatus: () => true,
        headers: this.buildAuthHeaders(),
      });
      return {
        healthy: response.status < 500,
        latencyMs: Date.now() - start,
        message: response.status < 500 ? 'OK' : `HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error.message,
      };
    }
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    const endpoint = this.findEndpoint(request.flowCode, 'submit')
      || this.findFirstByCategory('submit');

    if (!endpoint) {
      return { success: false, errorMessage: 'No submit endpoint configured for this connector' };
    }

    try {
      const mappedParams = this.applyParamMapping({
        ...request.formData,
        attachments: this.serializeAttachments(request.attachments),
      }, endpoint.paramMapping);
      const response = await this.executeEndpoint(endpoint, this.normalizeMappedParams(mappedParams));
      const mapped = this.applyResponseMapping(response, endpoint.responseMapping);

      return {
        success: mapped.success !== false,
        submissionId: this.normalizeSubmissionId(mapped.id || mapped.submissionId || mapped.data?.id),
        metadata: {
          ...mapped,
          deliveryPath: 'api',
          flowCode: request.flowCode,
          connectorId: this.config.connectorId,
        },
      };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    const endpoint = (this.preferredFlowCode
      ? this.findEndpoint(this.preferredFlowCode, 'query')
      : undefined)
      || this.findFirstByCategory('query');

    if (!endpoint) {
      return { status: 'error', statusDetail: { error: 'No query endpoint configured' } };
    }

    try {
      const params = this.buildSubmissionIdentifierParams(submissionId);
      const mappedParams = this.normalizeMappedParams(this.applyParamMapping(params, endpoint.paramMapping));
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, mappedParams);

      const response = await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, mappedParams);
      const mapped = this.applyResponseMapping(response, endpoint.responseMapping);

      return {
        status: mapped.status || 'unknown',
        statusDetail: mapped,
        timeline: mapped.timeline || mapped.logs || [],
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: error.message } };
    }
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    const endpoint = this.findFirstByCategory('list');

    if (!endpoint) {
      throw new Error(`No list endpoint configured for reference data: ${datasetCode}`);
    }

    const response = await this.executeEndpoint(endpoint, { datasetCode });
    const mapped = this.applyResponseMapping(response, endpoint.responseMapping);
    const items = mapped.data || mapped.items || [];

    return {
      datasetCode,
      datasetName: datasetCode,
      datasetType: datasetCode,
      syncMode: 'full',
      items: Array.isArray(items)
        ? items.map((item: any) => ({
            remoteItemId: item.id || item.remoteItemId,
            itemKey: item.id || item.key || item.code,
            itemLabel: item.name || item.label || item.displayName,
            itemValue: item.id || item.value,
            parentKey: item.parentId || item.parentKey,
            payload: item,
          }))
        : [],
    };
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    const endpoint = this.findFirstByCategory('cancel');
    if (!endpoint) {
      return { success: false, message: 'No cancel endpoint configured' };
    }

    try {
      const params = this.buildSubmissionIdentifierParams(submissionId);
      const mappedParams = this.normalizeMappedParams(this.applyParamMapping(params, endpoint.paramMapping));
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, mappedParams);
      await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, mappedParams);
      return { success: true, message: 'Cancelled successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    const endpoint = this.findFirstByCategory('urge');
    if (!endpoint) {
      return { success: false, message: 'No urge endpoint configured' };
    }

    try {
      const params = this.buildSubmissionIdentifierParams(submissionId);
      const mappedParams = this.normalizeMappedParams(this.applyParamMapping(params, endpoint.paramMapping));
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, mappedParams);
      await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, mappedParams);
      return { success: true, message: 'Urge sent successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    return { success: false, message: 'Delegate not supported by generic adapter' };
  }

  async supplement(request: SupplementRequest): Promise<SupplementResult> {
    const endpoint = this.findFirstByCategory('supplement') || this.findFirstByCategory('other');
    if (!endpoint) {
      return { success: false, message: 'Supplement not supported by generic adapter' };
    }

    try {
      const params = this.applyParamMapping({
        ...this.buildSubmissionIdentifierParams(request.submissionId),
        ...request.supplementData,
        attachments: this.serializeAttachments(request.attachments),
      }, endpoint.paramMapping);
      const normalizedParams = this.normalizeMappedParams(params);
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, normalizedParams);
      await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, normalizedParams);
      return { success: true, message: 'Supplement submitted successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ── Private: endpoint execution ───────────────────────────

  private async executeEndpoint(endpoint: EndpointDef, params: Record<string, any>): Promise<any> {
    const method = endpoint.httpMethod.toLowerCase();
    const url = endpoint.apiEndpoint;
    const headers = { ...this.buildAuthHeaders(), ...(endpoint.headers || {}) };

    if (this.cookieSession) {
      headers['Cookie'] = this.cookieSession;
    }

    const config: AxiosRequestConfig = {
      method: method as any,
      url,
      headers,
      timeout: 30000,
    };

    if (['post', 'put', 'patch'].includes(method)) {
      config.data = this.buildRequestBody(params, endpoint.bodyTemplate);
    } else {
      config.params = params;
    }

    try {
      const response = await this.client.request(config);
      return response.data;
    } catch (error: any) {
      // Retry once when auth can be refreshed locally.
      if (
        [401, 403].includes(Number(error.response?.status))
        && ['cookie', 'bearer', 'oauth2'].includes(this.config.authType)
      ) {
        await this.refreshAuth();
        config.headers = { ...this.buildAuthHeaders(), ...(endpoint.headers || {}) };
        if (this.cookieSession && config.headers) {
          (config.headers as Record<string, string>)['Cookie'] = this.cookieSession;
        }
        const retryResponse = await this.client.request(config);
        return retryResponse.data;
      }
      throw error;
    }
  }

  // ── Private: auth ─────────────────────────────────────────

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const auth = this.config.authConfig;

    switch (this.config.authType) {
      case 'apikey':
        if (auth.headerName && auth.token) {
          headers[auth.headerName] = auth.token;
        } else if (auth.token) {
          headers['x-token'] = auth.token;
        } else if (auth.apiKey) {
          headers[auth.headerName || 'X-API-Key'] = auth.apiKey;
        }
        break;
      case 'basic':
        if (auth.username != null && auth.password != null) {
          headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
        }
        break;
      case 'oauth2':
      case 'bearer': {
        const token = auth.accessToken || auth.token;
        if (token) {
          const headerName = auth.headerName || 'Authorization';
          const defaultPrefix = headerName.toLowerCase() === 'authorization' ? 'Bearer ' : '';
          const headerPrefix = auth.headerPrefix ?? defaultPrefix;
          headers[headerName] = `${headerPrefix}${token}`;
        }
        break;
      }
      // cookie auth handled via cookieSession
    }

    return headers;
  }

  private async authenticateCookie(): Promise<void> {
    const auth = this.config.authConfig;
    const loginPath = auth.loginPath || '/api/auth/login';

    const response = await this.client.post(loginPath, {
      username: auth.username,
      password: auth.password,
    }, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    const setCookies = response.headers['set-cookie'];
    if (setCookies && setCookies.length > 0) {
      this.cookieSession = setCookies.map((c: string) => c.split(';')[0]).join('; ');
    }
  }

  private async authenticateToken(): Promise<void> {
    const auth = this.config.authConfig;
    const loginPath = auth.loginPath || '/api/auth/login';

    const response = await this.client.post(loginPath, {
      username: auth.username,
      password: auth.password,
    }, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      throw new Error(`Token auth login failed with status ${response.status}`);
    }

    const token = this.extractAuthToken(response.data);
    if (!token) {
      throw new Error('Token auth login succeeded but no token was returned');
    }

    this.config.authConfig.token = token;
    this.config.authConfig.accessToken = token;
  }

  private extractAuthToken(body: any): string | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }

    const directFields = ['token', 'access_token', 'accessToken', 'sessionId', 'session_id', 'jwt'];
    for (const field of directFields) {
      if (typeof body[field] === 'string' && body[field].length > 0) {
        return body[field];
      }
    }

    const nested = body.data || body.result || body.response;
    if (nested && typeof nested === 'object') {
      for (const field of directFields) {
        if (typeof nested[field] === 'string' && nested[field].length > 0) {
          return nested[field];
        }
      }
    }

    return undefined;
  }

  // ── Private: mapping ──────────────────────────────────────

  private applyParamMapping(params: Record<string, any>, mapping: Record<string, any>): Record<string, any> {
    if (!mapping || Object.keys(mapping).length === 0) return params;

    const result: Record<string, any> = {};
    for (const [targetKey, rule] of Object.entries(mapping)) {
      if (typeof rule === 'string') {
        result[targetKey] = this.getNestedValue(params, rule);
      } else if (typeof rule === 'object' && rule !== null) {
        const { source, transform, default: defaultValue } = rule as any;
        let value = source ? this.getNestedValue(params, source) : undefined;
        if (value === undefined && defaultValue !== undefined) value = defaultValue;
        if (transform && value !== undefined) value = this.applyTransform(value, transform);
        result[targetKey] = value;
      }
    }
    return result;
  }

  private applyResponseMapping(response: any, mapping: Record<string, any>): Record<string, any> {
    if (!mapping || Object.keys(mapping).length === 0) return response;

    const result: Record<string, any> = {};
    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      if (typeof sourcePath === 'string') {
        result[targetKey] = this.getNestedValue(response, sourcePath);
      }
    }
    return result;
  }

  private normalizeMappedParams(params: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, this.normalizeParamValue(key, value)]),
    );
  }

  private normalizeParamValue(key: string, value: any): any {
    const semantic = resolveAssistantFieldPresentation({ key, label: key }).semanticKind;

    if (semantic === 'attachment' && Array.isArray(value) && value.length === 0) {
      return undefined;
    }

    if (
      (semantic === 'start_time' || semantic === 'end_time')
      && typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return `${value}${semantic === 'end_time' ? 'T18:00:00Z' : 'T09:00:00Z'}`;
    }

    return value;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private applyTransform(value: any, transform: string): any {
    if (!ALLOWED_TRANSFORMS.has(transform)) return value;
    switch (transform) {
      case 'toString': return String(value);
      case 'toNumber': return Number(value);
      case 'toBoolean': return Boolean(value);
      case 'toUpperCase': return String(value).toUpperCase();
      case 'toLowerCase': return String(value).toLowerCase();
      case 'toDate': return new Date(value).toISOString();
      case 'toArray': return Array.isArray(value) ? value : [value];
      default: return value;
    }
  }

  private buildRequestBody(params: Record<string, any>, template: any): any {
    if (!template) return params;

    if (typeof template === 'string') {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '');
    }

    if (typeof template === 'object' && template !== null) {
      const result: any = Array.isArray(template) ? [] : {};
      for (const [key, value] of Object.entries(template)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          result[key] = params[value.slice(2, -2)];
        } else if (typeof value === 'object' && value !== null) {
          result[key] = this.buildRequestBody(params, value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return template;
  }

  private serializeAttachments(attachments?: SubmitRequest['attachments']) {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    return attachments.map((item) => ({
      fileName: item.filename,
      filename: item.filename,
      mimeType: 'application/octet-stream',
      content: item.content.toString('base64'),
    }));
  }

  // ── Private: endpoint lookup ──────────────────────────────

  private indexEndpoints(): void {
    this.endpointsByCategory.clear();
    this.endpointsByFlowAndCategory.clear();

    for (const ep of this.endpoints) {
      // By category
      const list = this.endpointsByCategory.get(ep.category) || [];
      list.push(ep);
      this.endpointsByCategory.set(ep.category, list);

      // By flow+category
      if (ep.flowCode) {
        this.endpointsByFlowAndCategory.set(`${ep.flowCode}:${ep.category}`, ep);
      }
    }
  }

  private findEndpoint(flowCode: string, category: string): EndpointDef | undefined {
    return this.endpointsByFlowAndCategory.get(`${flowCode}:${category}`);
  }

  private findFirstByCategory(category: string): EndpointDef | undefined {
    return this.endpointsByCategory.get(category)?.[0];
  }

  private interpolatePath(path: string, params: Record<string, any>): string {
    return path.replace(/\{(\w+)\}/g, (_, key) => {
      const value = params[key];
      return value !== undefined ? encodeURIComponent(String(value)) : `{${key}}`;
    });
  }

  private buildSubmissionIdentifierParams(submissionId: string): Record<string, string> {
    return {
      submissionId,
      id: submissionId,
      application_id: submissionId,
      applicationId: submissionId,
    };
  }

  // ── Public: endpoint probing (for validation) ───────────────

  /**
   * 公开的通用端点调用方法 — 供 FlowDiscoveryService 等外部服务使用
   */
  async callEndpoint(
    apiEndpoint: string,
    httpMethod: string,
    params: Record<string, any>,
  ): Promise<any> {
    const endpoint: EndpointDef = {
      toolName: '_dynamic_call',
      category: 'other',
      apiEndpoint,
      httpMethod,
      paramMapping: {},
      responseMapping: {},
    };
    return this.executeEndpoint(endpoint, params);
  }

  /**
   * 探测单个端点的可达性，不发送实际写请求。
   * GET → HEAD, POST/PUT/DELETE → OPTIONS (降级 HEAD)
   */
  async probeEndpoint(endpoint: EndpointDef): Promise<{
    status: ProbeStatus;
    statusCode?: number;
    responseTimeMs?: number;
    error?: string;
  }> {
    const headers = { ...this.buildAuthHeaders(), ...(endpoint.headers || {}) };
    if (this.cookieSession) {
      headers['Cookie'] = this.cookieSession;
    }

    const url = endpoint.apiEndpoint;
    const isGet = endpoint.httpMethod.toUpperCase() === 'GET';
    const probeMethod = isGet ? 'HEAD' : 'OPTIONS';
    const start = Date.now();

    try {
      const resp = await this.client.request({
        method: probeMethod as any,
        url,
        headers,
        timeout: 5000,
        validateStatus: () => true,
      });

      // OPTIONS 返回 405，降级到 HEAD
      if (resp.status === 405 && probeMethod === 'OPTIONS') {
        const headResp = await this.client.head(url, {
          headers,
          timeout: 5000,
          validateStatus: () => true,
        });
        const result = classifyProbeStatus(headResp.status);
        return { ...result, responseTimeMs: Date.now() - start };
      }

      const result = classifyProbeStatus(resp.status);
      return { ...result, responseTimeMs: Date.now() - start };
    } catch (error: any) {
      return {
        status: 'unreachable',
        responseTimeMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  /**
   * 获取已加载的端点列表（供验证服务使用）
   */
  getLoadedEndpoints(): EndpointDef[] {
    return [...this.endpoints];
  }

  private normalizeSubmissionId(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }

    return undefined;
  }
}
