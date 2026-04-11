import axios, { AxiosInstance } from 'axios';
import {
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

/**
 * TokenHeaderAdapter — 处理"自定义 header 传 token"认证模式的通用适配器
 *
 * API 交互特征：
 *   1. 认证：POST 登录接口 → 返回 token → 后续请求通过自定义 header 携带
 *   2. 提交：POST 创建资源，可选 PUT 触发流转
 *   3. 响应：由 responseMapping 配置提取字段
 *   4. 发现：通过配置的 appListPath / processListPath 遍历
 *
 * 所有路径均由用户通过 config 传入，无内置默认路径。
 */

export interface TokenHeaderConfig {
  baseUrl: string;
  /** 预设 token，有则跳过登录 */
  token?: string;
  /** 登录凭证（用户名或工号） */
  credential?: string;
  /** 登录密码 */
  password?: string;
  /** token header 名称，默认 'Authorization' */
  tokenHeader?: string;
  /** 登录接口路径 */
  loginPath?: string;
  /** 应用列表接口路径 */
  appListPath?: string;
  /** 流程列表接口路径模板，{appId} 会被替换 */
  processListPath?: string;
  /** 提交接口路径 */
  submitPath?: string;
  /** 流转接口路径模板，{workId} 会被替换 */
  processPath?: string;
  /** 工作详情接口路径模板，{workId} 会被替换 */
  workDetailPath?: string;
  /** 工作日志接口路径模板，{workId} 会被替换 */
  workLogPath?: string;
  /** 健康检查路径 */
  healthCheckPath?: string;
  /** 参考数据接口路径映射，key 为 datasetCode，value 为接口路径 */
  referenceDataPaths?: Record<string, string>;
  /** 响应中表示成功的字段路径，默认 'success' */
  successField?: string;
  /** 响应中表示成功的值，默认 true */
  successValue?: any;
  /** 响应中数据字段路径，默认 'data' */
  dataField?: string;
  /** 响应中消息字段路径，默认 'message' */
  messageField?: string;
}

export class TokenHeaderAdapter implements OAAdapter {
  private client: AxiosInstance;
  private token?: string;
  private readonly headerName: string;
  private readonly config: TokenHeaderConfig;

  constructor(config: TokenHeaderConfig) {
    this.config = config;
    this.headerName = config.tokenHeader || 'Authorization';

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    if (config.token) {
      this.token = config.token;
      this.client.defaults.headers.common[this.headerName] = config.token;
    }
  }

  private isSuccess(data: any): boolean {
    const field = this.config.successField || 'success';
    const expectedValue = this.config.successValue ?? true;
    return data[field] === expectedValue;
  }

  private getData(data: any): any {
    const field = this.config.dataField || 'data';
    return data[field];
  }

  private getMessage(data: any): string {
    const field = this.config.messageField || 'message';
    return data[field] || 'Unknown error';
  }

  async authenticate(): Promise<string> {
    if (this.token) return this.token;

    if (!this.config.loginPath) {
      throw new Error('loginPath is required for authentication');
    }
    if (!this.config.credential || !this.config.password) {
      throw new Error('Credential and password required for authentication');
    }

    const response = await this.client.post(this.config.loginPath, {
      credential: this.config.credential,
      password: this.config.password,
    });

    if (!this.isSuccess(response.data)) {
      throw new Error(`Authentication failed: ${this.getMessage(response.data)}`);
    }

    const data = this.getData(response.data);
    this.token = data?.token || data;
    this.client.defaults.headers.common[this.headerName] = this.token;
    return this.token!;
  }

  async discover(): Promise<DiscoverResult> {
    await this.ensureAuthenticated();

    const discoveredFlows: DiscoverResult['discoveredFlows'] = [];

    if (!this.config.appListPath) {
      return {
        oaVendor: 'TokenHeader',
        oaVersion: '1.0',
        oaType: 'hybrid',
        authType: 'apikey',
        discoveredFlows,
      };
    }

    const appsResponse = await this.client.get(this.config.appListPath);
    if (!this.isSuccess(appsResponse.data)) {
      throw new Error(`Failed to get applications: ${this.getMessage(appsResponse.data)}`);
    }

    const applications = this.getData(appsResponse.data) || [];

    if (this.config.processListPath) {
      for (const app of applications) {
        try {
          const url = this.config.processListPath.replace('{appId}', app.id);
          const processResponse = await this.client.get(url);

          if (this.isSuccess(processResponse.data)) {
            for (const process of this.getData(processResponse.data) || []) {
              discoveredFlows.push({
                flowCode: process.id,
                flowName: process.name || process.alias || process.id,
                entryUrl: this.config.submitPath ? `${this.config.submitPath}/process/${process.id}` : '',
                submitUrl: this.config.submitPath || '',
                queryUrl: this.config.submitPath || '',
              });
            }
          }
        } catch {
          // skip inaccessible apps
        }
      }
    }

    return {
      oaVendor: 'TokenHeader',
      oaVersion: '1.0',
      oaType: 'hybrid',
      authType: 'apikey',
      discoveredFlows,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    const checkPath = this.config.healthCheckPath || '/';
    try {
      const response = await this.client.get(checkPath, { timeout: 5000 });
      return { healthy: response.status === 200, latencyMs: Date.now() - start, message: 'OK' };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.ensureAuthenticated();

    if (!this.config.submitPath) {
      return { success: false, errorMessage: 'submitPath is not configured' };
    }

    try {
      const createResponse = await this.client.post(this.config.submitPath, {
        process: request.flowCode,
        title: request.formData.title || '',
        data: request.formData,
      });

      if (!this.isSuccess(createResponse.data)) {
        return { success: false, errorMessage: this.getMessage(createResponse.data) };
      }

      const data = this.getData(createResponse.data);
      const workId = data?.id || data;

      // 如果配置了流转路径，执行第二步
      if (this.config.processPath && workId) {
        const processUrl = this.config.processPath.replace('{workId}', workId);
        const processResponse = await this.client.put(processUrl, {
          opinion: request.formData.opinion || '',
        });

        if (!this.isSuccess(processResponse.data)) {
          return { success: false, submissionId: workId, errorMessage: this.getMessage(processResponse.data) };
        }
      }

      return { success: true, submissionId: workId, metadata: { workId, processId: request.flowCode } };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.ensureAuthenticated();

    if (!this.config.workDetailPath) {
      return { status: 'error', statusDetail: { error: 'workDetailPath is not configured' } };
    }

    try {
      const detailUrl = this.config.workDetailPath.replace('{workId}', submissionId);
      const workResponse = await this.client.get(detailUrl);

      if (!this.isSuccess(workResponse.data)) {
        throw new Error(`Failed to get work: ${this.getMessage(workResponse.data)}`);
      }

      const work = this.getData(workResponse.data);

      const timeline: StatusResult['timeline'] = [];
      if (this.config.workLogPath) {
        const logUrl = this.config.workLogPath.replace('{workId}', submissionId);
        const logResponse = await this.client.get(logUrl);

        if (this.isSuccess(logResponse.data)) {
          for (const log of this.getData(logResponse.data) || []) {
            timeline.push({
              timestamp: log.createTime || log.timestamp || log.createdAt,
              status: log.routeName || log.activityName || log.status || 'unknown',
              operator: log.person || log.operator || log.user,
              comment: log.opinion || log.comment || log.remark,
            });
          }
        }
      }

      return {
        status: work?.activityName || work?.status || 'unknown',
        statusDetail: work || {},
        timeline,
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: error.message } };
    }
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    await this.ensureAuthenticated();

    const paths = this.config.referenceDataPaths || {};
    const endpoint = paths[datasetCode];

    if (!endpoint) {
      throw new Error(`No reference data path configured for dataset: ${datasetCode}. Available: ${Object.keys(paths).join(', ') || 'none'}`);
    }

    const response = await this.client.get(endpoint);
    if (!this.isSuccess(response.data)) {
      throw new Error(`Failed to load ${datasetCode}: ${this.getMessage(response.data)}`);
    }

    const rows = this.getData(response.data) || [];
    return {
      datasetCode,
      datasetName: datasetCode,
      datasetType: datasetCode,
      syncMode: 'full',
      items: rows.map((row: any) => ({
        remoteItemId: row.id,
        itemKey: row.id || row.distinguishedName || row.name,
        itemLabel: row.name || row.display || row.label || row.id,
        itemValue: row.id || row.unique || row.value,
        parentKey: row.superior || row.parent || row.parentId || undefined,
        payload: row,
      })),
    };
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    await this.ensureAuthenticated();

    if (!this.config.workDetailPath) {
      return { success: false, message: 'workDetailPath is not configured' };
    }

    try {
      const response = await this.client.delete(
        this.config.workDetailPath.replace('{workId}', submissionId),
      );
      if (!this.isSuccess(response.data)) {
        return { success: false, message: this.getMessage(response.data) };
      }
      return { success: true, message: 'Cancelled successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    await this.ensureAuthenticated();

    if (!this.config.workDetailPath) {
      return { success: false, message: 'workDetailPath is not configured' };
    }

    try {
      const response = await this.client.post(
        `${this.config.workDetailPath.replace('{workId}', submissionId)}/urge`,
        {},
      );
      if (!this.isSuccess(response.data)) {
        return { success: false, message: this.getMessage(response.data) };
      }
      return { success: true, message: 'Urge sent successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token) {
      await this.authenticate();
    }
  }
}
