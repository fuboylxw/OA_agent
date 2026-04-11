import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  CancelResult,
  DiscoverResult,
  HealthCheckResult,
  OAAdapter,
  ReferenceDataResult,
  StatusResult,
  SubmitRequest,
  SubmitResult,
  SupplementRequest,
  SupplementResult,
  UrgeResult,
} from './index';

/**
 * CookieSessionAdapter — 处理"cookie session 认证"模式的适配器
 *
 * API 交互特征：
 *   1. 认证：POST 登录接口 → 服务端返回 Set-Cookie → 后续请求携带 Cookie
 *   2. 会话过期：收到 401 时自动重新登录并重试
 *   3. 字段映射：支持 flowCode 别名 + 字段名 snake_case → camelCase 自动转换
 *   4. 附件：base64 编码内联提交
 *
 * 典型系统：传统 Java Web OA（如学校 OA、政务 OA）、基于 Session 的老系统
 */

export interface CookieSessionConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  /** 登录接口路径，默认 '/api/auth/login' */
  loginPath?: string;
  /** 健康检查路径，默认 '/api/health' */
  healthCheckPath?: string;
  /** 表单列表路径，默认 '/api/forms' */
  formsPath?: string;
  /** 提交路径，默认 '/api/applications' */
  submitPath?: string;
  /** 人员/部门目录路径，默认 '/api/directory' */
  directoryPath?: string;
  /** flowCode 别名映射 */
  flowCodeAliases?: Record<string, string>;
  /** 按表单分组的字段名映射 */
  fieldMappings?: Record<string, Record<string, string>>;
}

type CookieSessionFlow = {
  flowCode: string;
  flowName: string;
};

const DEFAULT_LOGIN_PATH = '/api/auth/login';

const DEFAULT_FLOW_CODE_ALIASES: Record<string, string> = {
  leave: 'leave',
  leave_request: 'leave',
  reimbursement: 'reimbursement',
  reimburse: 'reimbursement',
  vehicle: 'vehicle',
  vehicle_access: 'vehicle',
  project: 'project',
  project_application: 'project',
};

const DEFAULT_FIELD_MAPPINGS: Record<string, Record<string, string>> = {
  leave: {
    leave_type: 'leaveType',
    start_date: 'startDate',
    end_date: 'endDate',
    contact_phone: 'contactPhone',
  },
  reimbursement: {
    reimbursement_type: 'reimbursementType',
    budget_code: 'budgetCode',
    payee_name: 'payeeName',
    bank_account: 'bankAccount',
  },
  vehicle: {
    vehicle_plate: 'vehiclePlate',
    driver_name: 'driverName',
    enter_date: 'enterDate',
    exit_date: 'exitDate',
    companion_count: 'companionCount',
  },
  project: {
    project_name: 'projectName',
    project_type: 'projectType',
    start_date: 'startDate',
    end_date: 'endDate',
  },
};

export class CookieSessionAdapter implements OAAdapter {
  private readonly client: AxiosInstance;
  private sessionCookie?: string;
  private readonly flowCodeAliases: Record<string, string>;
  private readonly fieldMappings: Record<string, Record<string, string>>;
  private readonly paths: {
    loginPath: string;
    healthCheckPath: string;
    formsPath: string;
    submitPath: string;
    directoryPath: string;
  };

  constructor(
    private readonly config: CookieSessionConfig,
    private readonly flows: CookieSessionFlow[] = [],
  ) {
    this.flowCodeAliases = config.flowCodeAliases || DEFAULT_FLOW_CODE_ALIASES;
    this.fieldMappings = config.fieldMappings || DEFAULT_FIELD_MAPPINGS;
    this.paths = {
      loginPath: config.loginPath || DEFAULT_LOGIN_PATH,
      healthCheckPath: config.healthCheckPath || '/api/health',
      formsPath: config.formsPath || '/api/forms',
      submitPath: config.submitPath || '/api/applications',
      directoryPath: config.directoryPath || '/api/directory',
    };

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async authenticate(): Promise<string> {
    if (this.sessionCookie) return this.sessionCookie;

    if (!this.config.username || !this.config.password) {
      throw new Error('Username and password required for cookie session authentication');
    }

    const response = await this.client.post(
      this.paths.loginPath,
      { username: this.config.username, password: this.config.password },
      { validateStatus: () => true },
    );

    if (response.status !== 200) {
      throw new Error(response.data?.message || 'Cookie session login failed');
    }

    const cookie = this.serializeCookies(response.headers['set-cookie']);
    if (!cookie) {
      throw new Error('Login succeeded but no session cookie returned');
    }

    this.sessionCookie = cookie;
    this.client.defaults.headers.common.Cookie = cookie;
    return cookie;
  }

  async discover(): Promise<DiscoverResult> {
    const data = await this.request<{ forms?: Array<{ code: string; name: string }> }>({
      method: 'GET',
      url: this.paths.formsPath,
    });

    const forms = data.forms || [];
    return {
      oaVendor: 'CookieSession',
      oaVersion: '1.0.0',
      oaType: 'openapi',
      authType: 'cookie',
      discoveredFlows: forms.map(form => ({
        flowCode: this.resolveFlowCodeForForm(form.code, form.name),
        flowName: form.name || form.code,
        entryUrl: this.paths.submitPath,
        submitUrl: this.paths.submitPath,
        queryUrl: `${this.paths.submitPath}/${form.code}`,
      })),
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
    try {
      const formCode = this.resolveFormCode(request.flowCode);
      const response = await this.request<{ application?: { id: string; status: string }; message?: string }>({
        method: 'POST',
        url: this.paths.submitPath,
        data: {
          formCode,
          data: this.mapSubmissionData(formCode, request.formData),
          attachments: (request.attachments || []).map(item => ({
            fileName: item.filename,
            mimeType: 'application/octet-stream',
            content: item.content.toString('base64'),
          })),
          ccUserIds: [],
        },
      });

      return {
        success: true,
        submissionId: response.application?.id,
        metadata: { status: response.application?.status, formCode, message: response.message },
      };
    } catch (error: any) {
      return { success: false, errorMessage: this.extractErrorMessage(error) };
    }
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    try {
      const response = await this.request<{ application?: any }>({
        method: 'GET',
        url: `${this.paths.submitPath}/${encodeURIComponent(submissionId)}`,
      });

      const app = response.application;
      if (!app) {
        return { status: 'error', statusDetail: { error: 'Application not found', submissionId } };
      }

      return {
        status: app.status || app.currentStep?.status || 'unknown',
        statusDetail: {
          applicationId: app.id,
          formCode: app.formCode,
          formName: app.formName,
          category: app.category,
          currentStepIndex: app.currentStepIndex,
          currentStepName: app.currentStep?.name,
          currentStepStatus: app.currentStep?.status,
          updatedAt: app.updatedAt,
          workflow: app.workflow,
        },
        timeline: (app.logs || []).map((log: any) => ({
          timestamp: log.at || app.updatedAt || new Date().toISOString(),
          status: log.action || 'unknown',
          operator: log.actorName,
          comment: log.comment,
        })),
      };
    } catch (error: any) {
      return { status: 'error', statusDetail: { error: this.extractErrorMessage(error), submissionId } };
    }
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    const normalized = datasetCode.toLowerCase();
    const response = await this.request<{ users?: Array<{
      id: string; username: string; displayName: string; department?: string;
    }> }>({ method: 'GET', url: this.paths.directoryPath });

    const users = response.users || [];

    if (['user', 'users', 'person', 'persons'].includes(normalized)) {
      return {
        datasetCode: 'user', datasetName: '人员', datasetType: 'user', syncMode: 'full',
        items: users.map(u => ({
          remoteItemId: u.id, itemKey: u.id,
          itemLabel: u.displayName || u.username, itemValue: u.id,
          parentKey: u.department || undefined, payload: u,
        })),
      };
    }

    if (['department', 'departments'].includes(normalized)) {
      const deptMap = new Map<string, { department: string }>();
      for (const u of users) {
        if (u.department && !deptMap.has(u.department)) {
          deptMap.set(u.department, { department: u.department });
        }
      }
      return {
        datasetCode: 'department', datasetName: '部门', datasetType: 'department', syncMode: 'full',
        items: [...deptMap.values()].map(d => ({
          itemKey: d.department, itemLabel: d.department, itemValue: d.department, payload: d,
        })),
      };
    }

    throw new Error(`Unsupported reference dataset: ${datasetCode}`);
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    try {
      const response = await this.request<{ message?: string }>({
        method: 'POST',
        url: `${this.paths.submitPath}/${encodeURIComponent(submissionId)}/recall`,
        data: { comment: '由 OA Agent 发起撤回' },
      });
      return { success: true, message: response.message || 'Recalled successfully' };
    } catch (error: any) {
      return { success: false, message: this.extractErrorMessage(error) };
    }
  }

  async urge(): Promise<UrgeResult> {
    return { success: true, message: 'Urge not supported by this system' };
  }

  async supplement(request: SupplementRequest): Promise<SupplementResult> {
    try {
      const attachments = (request.attachments || []).map(item => ({
        fileName: item.filename,
        mimeType: 'application/octet-stream',
        content: item.content.toString('base64'),
      }));
      const response = await this.request<{ message?: string }>({
        method: 'POST',
        url: `${this.paths.submitPath}/${encodeURIComponent(request.submissionId)}/attachments`,
        data: { attachments },
      });
      return { success: true, message: response.message || 'Supplement added successfully' };
    } catch (error: any) {
      return { success: false, message: this.extractErrorMessage(error) };
    }
  }

  // ── Private: HTTP with auto-retry on 401 ──────────────────

  private async ensureAuthenticated() {
    if (!this.sessionCookie) await this.authenticate();
  }

  private async request<T>(config: AxiosRequestConfig, retryOnUnauthorized = true): Promise<T> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401 && retryOnUnauthorized) {
        this.sessionCookie = undefined;
        delete this.client.defaults.headers.common.Cookie;
        await this.authenticate();
        return this.request<T>(config, false);
      }
      throw error;
    }
  }

  // ── Private: field mapping ────────────────────────────────

  private resolveFormCode(flowCode: string) {
    const normalized = flowCode.trim().toLowerCase();
    if (this.flowCodeAliases[normalized]) return this.flowCodeAliases[normalized];

    const matchedFlow = this.flows.find(f => f.flowCode.trim().toLowerCase() === normalized);
    if (matchedFlow) return this.resolveFormCodeFromName(matchedFlow.flowName);

    return this.resolveFormCodeFromName(flowCode);
  }

  private resolveFlowCodeForForm(formCode: string, formName: string) {
    const matchedFlow = this.flows.find(f => {
      const n = f.flowCode.trim().toLowerCase();
      return this.flowCodeAliases[n] === formCode || f.flowName === formName;
    });
    return matchedFlow?.flowCode || formCode.toUpperCase();
  }

  private resolveFormCodeFromName(value: string) {
    const n = value.toLowerCase();
    if (n.includes('leave') || value.includes('请假')) return 'leave';
    if (n.includes('reimburse') || value.includes('报销')) return 'reimbursement';
    if (n.includes('vehicle') || value.includes('进出车')) return 'vehicle';
    if (n.includes('project') || value.includes('项目')) return 'project';
    return n;
  }

  private mapSubmissionData(formCode: string, formData: Record<string, any>) {
    const fieldMap = this.fieldMappings[formCode] || {};
    const mapped: Record<string, any> = {};
    for (const [key, value] of Object.entries(formData)) {
      mapped[fieldMap[key] || key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    }
    return mapped;
  }

  // ── Private: utils ────────────────────────────────────────

  private serializeCookies(rawCookies?: string[] | string) {
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    return cookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
  }

  private extractErrorMessage(error: any) {
    return error?.response?.data?.message || error?.message || 'Unknown error';
  }
}
