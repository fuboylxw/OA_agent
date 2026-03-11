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

  constructor(
    private readonly config: GenericHttpAdapterConfig,
    private readonly endpointLoader: EndpointLoader,
  ) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async init(): Promise<void> {
    this.endpoints = await this.endpointLoader.loadEndpoints(this.config.connectorId);
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
      const mappedParams = this.applyParamMapping(request.formData, endpoint.paramMapping);
      const response = await this.executeEndpoint(endpoint, mappedParams);
      const mapped = this.applyResponseMapping(response, endpoint.responseMapping);

      return {
        success: mapped.success !== false,
        submissionId: mapped.id || mapped.submissionId || mapped.data?.id,
        metadata: mapped,
      };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    const endpoint = this.findFirstByCategory('query');

    if (!endpoint) {
      return { status: 'error', statusDetail: { error: 'No query endpoint configured' } };
    }

    try {
      const params = { submissionId, id: submissionId };
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, params);
      const mappedParams = this.applyParamMapping(params, endpoint.paramMapping);

      const response = await this.executeEndpoint(
        { ...endpoint, apiEndpoint: apiPath },
        mappedParams,
      );
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
      const params = { submissionId, id: submissionId };
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, params);
      await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, params);
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
      const params = { submissionId, id: submissionId };
      const apiPath = this.interpolatePath(endpoint.apiEndpoint, params);
      await this.executeEndpoint({ ...endpoint, apiEndpoint: apiPath }, params);
      return { success: true, message: 'Urge sent successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    return { success: false, message: 'Delegate not supported by generic adapter' };
  }

  async supplement(request: SupplementRequest): Promise<SupplementResult> {
    return { success: false, message: 'Supplement not supported by generic adapter' };
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
      // Retry on 401 for cookie auth
      if (error.response?.status === 401 && this.config.authType === 'cookie') {
        await this.refreshAuth();
        if (this.cookieSession) {
          config.headers = { ...config.headers, Cookie: this.cookieSession };
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
        headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
        break;
      case 'oauth2':
        if (auth.accessToken) {
          headers['Authorization'] = `Bearer ${auth.accessToken}`;
        }
        break;
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
    status: 'reachable' | 'unreachable' | 'auth_failed' | 'not_found' | 'server_error' | 'unknown';
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
        return this.classifyProbeStatus(headResp.status, Date.now() - start);
      }

      return this.classifyProbeStatus(resp.status, Date.now() - start);
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

  private classifyProbeStatus(
    statusCode: number,
    responseTimeMs: number,
  ): {
    status: 'reachable' | 'unreachable' | 'auth_failed' | 'not_found' | 'server_error' | 'unknown';
    statusCode: number;
    responseTimeMs: number;
  } {
    let status: 'reachable' | 'unreachable' | 'auth_failed' | 'not_found' | 'server_error' | 'unknown';

    if (statusCode >= 200 && statusCode < 400) {
      status = 'reachable';
    } else if (statusCode === 401 || statusCode === 403) {
      status = 'auth_failed';
    } else if (statusCode === 404) {
      status = 'not_found';
    } else if (statusCode === 405) {
      status = 'unknown'; // 方法不允许，但端点可能存在
    } else if (statusCode >= 500) {
      status = 'server_error';
    } else {
      status = 'unknown';
    }

    return { status, statusCode, responseTimeMs };
  }
}
