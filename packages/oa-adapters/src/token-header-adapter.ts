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
 * TokenHeaderAdapter — 处理"自定义 header 传 token"认证模式的适配器
 *
 * API 交互特征：
 *   1. 认证：POST 登录接口 → 返回 token → 后续请求通过自定义 header（如 x-token）携带
 *   2. 提交：两步操作 — 先 POST 创建资源，再 PUT 触发流转
 *   3. 响应：统一包装格式 { type: 'success'|'error', data: ..., message: ... }
 *   4. 发现：需要遍历"应用→流程"两级结构
 *
 * 典型系统：O2OA、蓝凌 EKP 等使用自定义 token header 的系统
 */

export interface TokenHeaderConfig {
  baseUrl: string;
  /** 预设 token，有则跳过登录 */
  token?: string;
  /** 登录凭证（用户名或工号） */
  credential?: string;
  /** 登录密码 */
  password?: string;
  /** token header 名称，默认 'x-token' */
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
}

const DEFAULTS = {
  tokenHeader: 'x-token',
  loginPath: '/x_organization_assemble_authentication/jaxrs/authentication',
  appListPath: '/x_processplatform_assemble_surface/jaxrs/application/list',
  processListPath: '/x_processplatform_assemble_surface/jaxrs/process/list/application/{appId}',
  submitPath: '/x_processplatform_assemble_surface/jaxrs/work',
  processPath: '/x_processplatform_assemble_surface/jaxrs/work/{workId}/process',
  workDetailPath: '/x_processplatform_assemble_surface/jaxrs/work/{workId}',
  workLogPath: '/x_processplatform_assemble_surface/jaxrs/worklog/work/{workId}',
  healthCheckPath: '/x_desktop/index.html',
};

export class TokenHeaderAdapter implements OAAdapter {
  private client: AxiosInstance;
  private token?: string;
  private readonly headerName: string;
  private readonly paths: typeof DEFAULTS;

  constructor(private config: TokenHeaderConfig) {
    this.headerName = config.tokenHeader || DEFAULTS.tokenHeader;
    this.paths = {
      tokenHeader: this.headerName,
      loginPath: config.loginPath || DEFAULTS.loginPath,
      appListPath: config.appListPath || DEFAULTS.appListPath,
      processListPath: config.processListPath || DEFAULTS.processListPath,
      submitPath: config.submitPath || DEFAULTS.submitPath,
      processPath: config.processPath || DEFAULTS.processPath,
      workDetailPath: config.workDetailPath || DEFAULTS.workDetailPath,
      workLogPath: config.workLogPath || DEFAULTS.workLogPath,
      healthCheckPath: config.healthCheckPath || DEFAULTS.healthCheckPath,
    };

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

  async authenticate(): Promise<string> {
    if (this.token) return this.token;

    if (!this.config.credential || !this.config.password) {
      throw new Error('Credential and password required for authentication');
    }

    const response = await this.client.post(this.paths.loginPath, {
      credential: this.config.credential,
      password: this.config.password,
    });

    if (response.data.type !== 'success') {
      throw new Error(`Authentication failed: ${response.data.message || 'Unknown error'}`);
    }

    this.token = response.data.data.token;
    this.client.defaults.headers.common[this.headerName] = this.token;
    return this.token!;
  }

  async discover(): Promise<DiscoverResult> {
    await this.ensureAuthenticated();

    const appsResponse = await this.client.get(this.paths.appListPath);
    if (appsResponse.data.type !== 'success') {
      throw new Error(`Failed to get applications: ${appsResponse.data.message}`);
    }

    const applications = appsResponse.data.data || [];
    const discoveredFlows: DiscoverResult['discoveredFlows'] = [];

    for (const app of applications) {
      try {
        const url = this.paths.processListPath.replace('{appId}', app.id);
        const processResponse = await this.client.get(url);

        if (processResponse.data.type === 'success') {
          for (const process of processResponse.data.data || []) {
            discoveredFlows.push({
              flowCode: process.id,
              flowName: process.name || process.alias || process.id,
              entryUrl: `${this.paths.submitPath}/process/${process.id}`,
              submitUrl: this.paths.submitPath,
              queryUrl: this.paths.submitPath,
            });
          }
        }
      } catch {
        // skip inaccessible apps
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
    try {
      const response = await this.client.get(this.paths.healthCheckPath, { timeout: 5000 });
      return { healthy: response.status === 200, latencyMs: Date.now() - start, message: 'OK' };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.ensureAuthenticated();

    try {
      // Step 1: create work
      const createResponse = await this.client.post(this.paths.submitPath, {
        process: request.flowCode,
        title: request.formData.title || '新建工作',
        data: request.formData,
      });

      if (createResponse.data.type !== 'success') {
        return { success: false, errorMessage: createResponse.data.message || 'Failed to create work' };
      }

      const workId = createResponse.data.data.id;

      // Step 2: process (submit/route)
      const processUrl = this.paths.processPath.replace('{workId}', workId);
      const processResponse = await this.client.put(processUrl, {
        routeName: '提交',
        opinion: request.formData.opinion || '',
      });

      if (processResponse.data.type !== 'success') {
        return { success: false, submissionId: workId, errorMessage: processResponse.data.message || 'Failed to process work' };
      }

      return { success: true, submissionId: workId, metadata: { workId, processId: request.flowCode } };
    } catch (error: any) {
      return { success: false, errorMessage: error.message };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.ensureAuthenticated();

    try {
      const detailUrl = this.paths.workDetailPath.replace('{workId}', submissionId);
      const workResponse = await this.client.get(detailUrl);

      if (workResponse.data.type !== 'success') {
        throw new Error(`Failed to get work: ${workResponse.data.message}`);
      }

      const work = workResponse.data.data;

      const logUrl = this.paths.workLogPath.replace('{workId}', submissionId);
      const logResponse = await this.client.get(logUrl);

      const timeline: StatusResult['timeline'] = [];
      if (logResponse.data.type === 'success') {
        for (const log of logResponse.data.data || []) {
          timeline.push({
            timestamp: log.createTime,
            status: log.routeName || log.activityName || 'unknown',
            operator: log.person,
            comment: log.opinion,
          });
        }
      }

      return {
        status: work.activityName || 'unknown',
        statusDetail: {
          workId: work.id,
          title: work.title,
          activityName: work.activityName,
          activityType: work.activityType,
          currentPerson: work.currentPerson,
        },
        timeline,
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: error.message } };
    }
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    await this.ensureAuthenticated();

    const normalized = datasetCode.toLowerCase();
    let endpoint: string;
    let datasetName: string;
    let datasetType: string;

    if (['department', 'departments'].includes(normalized)) {
      endpoint = '/x_organization_assemble_express/jaxrs/department/list';
      datasetName = '部门';
      datasetType = 'department';
    } else if (['user', 'users', 'person', 'persons'].includes(normalized)) {
      endpoint = '/x_organization_assemble_express/jaxrs/person/list';
      datasetName = '人员';
      datasetType = 'user';
    } else {
      throw new Error(`Unsupported reference dataset: ${datasetCode}`);
    }

    const response = await this.client.get(endpoint);
    if (response.data.type !== 'success') {
      throw new Error(`Failed to load ${datasetCode}: ${response.data.message || 'Unknown error'}`);
    }

    const rows = response.data.data || [];
    return {
      datasetCode: datasetType,
      datasetName,
      datasetType,
      syncMode: 'full',
      items: rows.map((row: any) => ({
        remoteItemId: row.id,
        itemKey: row.id || row.distinguishedName || row.name,
        itemLabel: row.name || row.display || row.id,
        itemValue: row.id || row.unique,
        parentKey: row.superior || row.parent || undefined,
        payload: row,
      })),
    };
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.delete(
        this.paths.workDetailPath.replace('{workId}', submissionId),
      );
      if (response.data.type !== 'success') {
        return { success: false, message: response.data.message || 'Failed to cancel work' };
      }
      return { success: true, message: 'Work cancelled successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.post(
        `${this.paths.workDetailPath.replace('{workId}', submissionId)}/urge`,
        {},
      );
      if (response.data.type !== 'success') {
        return { success: false, message: response.data.message || 'Failed to urge work' };
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
