import axios, { AxiosInstance } from 'axios';
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
} from './index';
import type { AdapterLifecycle } from './registry';

/**
 * OAuth2RefreshAdapter — 处理"OAuth2 Bearer token + 自动刷新"认证模式的适配器
 *
 * API 交互特征：
 *   1. 认证：通过 appKey/appSecret 换取 access_token，带过期时间
 *   2. token 过期前自动刷新，无需用户干预
 *   3. 请求：标准 Authorization: Bearer {token} header
 *   4. 响应：通常有 errcode/errmsg 错误码体系
 *
 * 典型系统：钉钉、飞书、企业微信、华为 WeLink 等开放平台
 */

export interface OAuth2RefreshConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  /** 获取 token 的路径，默认 '/gettoken' */
  tokenPath?: string;
  /** token 参数传递方式：'query' 放 URL 参数，'header' 放 Authorization header */
  tokenDelivery?: 'query' | 'header';
  /** token 在 query 中的参数名，默认 'access_token' */
  tokenQueryParam?: string;
  /** 流程列表路径 */
  processListPath?: string;
  /** 提交路径 */
  submitPath?: string;
  /** 查询路径模板，{instanceId} 会被替换 */
  queryPath?: string;
  /** 部门列表路径 */
  departmentListPath?: string;
  /** 健康检查路径 */
  healthCheckPath?: string;
  /** 成功响应的错误码值，默认 0 */
  successCode?: number;
  /** 错误码字段名，默认 'errcode' */
  errorCodeField?: string;
  /** 错误消息字段名，默认 'errmsg' */
  errorMsgField?: string;
}

export class OAuth2RefreshAdapter implements OAAdapter, AdapterLifecycle {
  private client: AxiosInstance;
  private accessToken?: string;
  private tokenExpiresAt = 0;
  private readonly successCode: number;
  private readonly errorCodeField: string;
  private readonly errorMsgField: string;

  constructor(private config: OAuth2RefreshConfig) {
    this.successCode = config.successCode ?? 0;
    this.errorCodeField = config.errorCodeField || 'errcode';
    this.errorMsgField = config.errorMsgField || 'errmsg';

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async init(): Promise<void> {
    await this.refreshAuth();
  }

  async destroy(): Promise<void> {
    this.accessToken = undefined;
    this.tokenExpiresAt = 0;
  }

  async refreshAuth(): Promise<void> {
    const tokenPath = this.config.tokenPath || '/gettoken';

    const response = await this.client.get(tokenPath, {
      params: {
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      },
    });

    if (response.data[this.errorCodeField] !== this.successCode) {
      throw new Error(`OAuth2 token fetch failed: ${response.data[this.errorMsgField]}`);
    }

    this.accessToken = response.data.access_token;
    // Refresh 5 minutes before expiry
    const expiresIn = response.data.expires_in || 7200;
    this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;
  }

  // ── OAAdapter ─────────────────────────────────────────────

  async discover(): Promise<DiscoverResult> {
    await this.ensureToken();

    const path = this.config.processListPath || '/topapi/process/listbyuserid';
    const response = await this.authedPost(path, { userid: 'manager' });

    const processList = response.result?.process_list || [];
    return {
      oaVendor: 'OAuth2Refresh',
      oaVersion: '2.0',
      oaType: 'openapi',
      authType: 'oauth2',
      discoveredFlows: processList.map((p: any) => ({
        flowCode: p.process_code,
        flowName: p.name,
      })),
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.ensureToken();
      return { healthy: true, latencyMs: Date.now() - start, message: 'OK' };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.ensureToken();

    try {
      const path = this.config.submitPath || '/topapi/processinstance/create';
      const response = await this.authedPost(path, {
        process_code: request.flowCode,
        originator_user_id: request.formData.userId || 'manager',
        dept_id: request.formData.deptId || -1,
        form_component_values: this.buildFormValues(request.formData),
      });

      if (response[this.errorCodeField] !== this.successCode) {
        return { success: false, errorMessage: response[this.errorMsgField] };
      }

      return {
        success: true,
        submissionId: response.process_instance_id,
        metadata: { processCode: request.flowCode },
      };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.ensureToken();

    try {
      const path = this.config.queryPath?.replace('{instanceId}', submissionId)
        || '/topapi/processinstance/get';
      const response = await this.authedPost(path, { process_instance_id: submissionId });

      const instance = response.process_instance;
      return {
        status: instance?.status || 'unknown',
        statusDetail: {
          title: instance?.title,
          result: instance?.result,
          businessId: instance?.business_id,
        },
        timeline: (instance?.operation_records || []).map((r: any) => ({
          timestamp: r.date,
          status: r.operation_type,
          operator: r.userid,
          comment: r.remark,
        })),
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: error.message } };
    }
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    await this.ensureToken();

    if (datasetCode.toLowerCase().startsWith('department')) {
      const path = this.config.departmentListPath || '/topapi/v2/department/listsub';
      const response = await this.authedPost(path, { dept_id: 1 });

      const depts = response.result || [];
      return {
        datasetCode: 'department',
        datasetName: '部门',
        datasetType: 'department',
        syncMode: 'full',
        items: depts.map((d: any) => ({
          remoteItemId: String(d.dept_id),
          itemKey: String(d.dept_id),
          itemLabel: d.name,
          itemValue: String(d.dept_id),
          parentKey: d.parent_id ? String(d.parent_id) : undefined,
          payload: d,
        })),
      };
    }

    throw new Error(`Unsupported dataset: ${datasetCode}`);
  }

  async cancel(_submissionId: string): Promise<CancelResult> {
    return { success: false, message: 'Cancel not supported via OAuth2 API' };
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    return { success: true, message: `Urge notification sent for ${submissionId}` };
  }

  // ── Private ───────────────────────────────────────────────

  private async ensureToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.refreshAuth();
    }
  }

  private async authedPost(path: string, data: any): Promise<any> {
    const delivery = this.config.tokenDelivery || 'query';
    const config: any = {};

    if (delivery === 'query') {
      const paramName = this.config.tokenQueryParam || 'access_token';
      config.params = { [paramName]: this.accessToken };
    } else {
      config.headers = { Authorization: `Bearer ${this.accessToken}` };
    }

    const response = await this.client.post(path, data, config);
    return response.data;
  }

  private buildFormValues(formData: Record<string, any>) {
    return Object.entries(formData)
      .filter(([key]) => !['userId', 'deptId'].includes(key))
      .map(([name, value]) => ({ name, value: String(value) }));
  }
}
