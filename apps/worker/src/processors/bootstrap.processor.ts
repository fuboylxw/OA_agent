import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import axios from 'axios';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { ApiAnalyzerAgent, BusinessProcess, Endpoint } from '../agents/api-analyzer.agent';
import { BootstrapRepairAgent } from '../agents/bootstrap-repair.agent';
import { recordRuntimeDiagnostic } from '@uniflow/agent-kernel';
import {
  BOOTSTRAP_JOB_HEARTBEAT_INTERVAL_MS,
  BOOTSTRAP_TERMINAL_STATUSES,
  buildFullUrl,
  getNestedValue,
} from '@uniflow/shared-types';

type ValidationOverall = 'passed' | 'partial' | 'failed';
type ValidationFailureType =
  | 'auth_failed'
  | 'network_unreachable'
  | 'endpoint_not_found'
  | 'param_error'
  | 'mapping_error'
  | 'purpose_mismatch'
  | 'server_error'
  | 'missing_submit'
  | 'no_base_url'
  | 'unknown';

type RepairAttemptStatus = 'fixed' | 'failed' | 'skipped' | 'rejected';

type EndpointProbeStatus = 'passed' | 'failed' | 'skipped';

interface EndpointProbeResult {
  endpointName: string;
  category: string;
  method: string;
  path: string;
  status: EndpointProbeStatus;
  checkedWith: 'core_validation' | 'endpoint_probe';
  reachable: boolean;
  usable: boolean;
  statusCode?: number | null;
  responseStructureValid?: boolean | null;
  statusFound?: boolean | null;
  failureType?: ValidationFailureType;
  reason?: string | null;
}

interface ProcessValidationResult {
  processCode: string;
  overall: ValidationOverall;
  failureType?: ValidationFailureType;
  repairable?: boolean;
  paramStructure?: any;
  submit?: any;
  query?: any;
  cancel?: any;
  endpointChecks?: EndpointProbeResult[];
  reason?: string;
}

interface ValidationSummary {
  validationResults: ProcessValidationResult[];
  passedProcesses: BusinessProcess[];
  passedCount: number;
  partialCount: number;
  failedCount: number;
}

interface ValidationOptions {
  reportId?: string;
  evidenceType?: string;
  evidenceLabel?: string;
}

interface FlowRepairSummary {
  automated: boolean;
  attempts: number;
  lastStatus: RepairAttemptStatus | 'not_attempted';
  lastFailureType: ValidationFailureType | null;
  lastSummary: string | null;
  lastConfidence: number | null;
  lastAttemptAt: string | null;
}

interface BootstrapProcessJobPayload {
  jobId: string;
  queueJobId?: string;
  recoveryTrigger?: string;
}

const MAX_SELF_HEAL_ATTEMPTS = 2;
const REPAIRABLE_FAILURE_TYPES = new Set<ValidationFailureType>([
  'param_error',
  'endpoint_not_found',
  'mapping_error',
  'missing_submit',
  'purpose_mismatch',
]);

@Processor('bootstrap')
@Injectable()
export class BootstrapProcessor {
  private readonly logger = new Logger(BootstrapProcessor.name);
  private readonly apiAnalyzer = new ApiAnalyzerAgent();
  private readonly bootstrapRepairAgent = new BootstrapRepairAgent();
  private readonly prisma: PrismaService;
  private cookieSessionCache: Map<string, { cookie: string; expiresAt: number }> = new Map();

  constructor(@Inject('PrismaService') prisma: PrismaService) {
    this.prisma = prisma;
  }

  @Process('process')
  async handleBootstrap(job: Job<BootstrapProcessJobPayload>) {
    const { jobId, queueJobId } = job.data;
    let stopHeartbeat: (() => void) | undefined;

    try {
      this.logger.log(`Processing job ${jobId}${queueJobId ? ` (queue ${queueJobId})` : ''}`);

      let bootstrapJob = await this.prisma.bootstrapJob.findUnique({
        where: { id: jobId },
        include: { sources: true },
      });

      if (!bootstrapJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      const queueGuard = this.shouldSkipQueuedExecution(bootstrapJob, queueJobId);
      if (queueGuard.skip) {
        this.logger.warn(`Skipping bootstrap job ${jobId}: ${queueGuard.reason}`);
        return { success: false, skipped: true, reason: queueGuard.reason };
      }

      stopHeartbeat = this.startJobHeartbeat(jobId);
      await this.touchJobHeartbeat(jobId);

      // 1. DISCOVERING
      await this.transitionState(jobId, 'DISCOVERING');
      const apiDoc = await this.runDiscovery(bootstrapJob);

      // 2. PARSING
      await this.transitionState(jobId, 'PARSING');
      const parsedProcesses = await this.runParsing(bootstrapJob, apiDoc);

      const totalEp = parsedProcesses.reduce((sum, process) => sum + process.endpoints.length, 0);
      const report = await this.prisma.bootstrapReport.create({
        data: {
          bootstrapJobId: jobId,
          oclLevel: 'OCL0',
          coverage: 0,
          confidence: 0.5,
          risk: 'medium',
          evidence: [{
            type: 'llm_analysis',
            description: `LLM Agent identified ${parsedProcesses.length} business processes with ${totalEp} endpoints`,
            confidence: 0.5,
          }],
          recommendation: '',
        },
      });
      const reportId = report.id;

      if (parsedProcesses.length === 0) {
        this.logger.warn(`No business processes identified for job ${jobId}`);
        await this.appendReportEvidence(reportId, [{
          type: 'parsing_failure',
          description: 'No business processes were identified from the provided API document',
          confidence: 0,
        }], {
          oclLevel: 'OCL0',
          coverage: 0,
          confidence: 0,
          risk: 'high',
          recommendation: '请检查 API 文档内容、servers 配置、业务接口命名和认证信息后重新处理。',
        });
        await this.transitionState(jobId, 'FAILED');
        return { success: false, reason: 'no_business_processes' };
      }

      // 3. AUTH_PROBING — 自动探测认证方式
      await this.transitionState(jobId, 'AUTH_PROBING');
      await this.runAuthProbing(bootstrapJob, parsedProcesses, apiDoc);
      bootstrapJob = await this.prisma.bootstrapJob.findUnique({
        where: { id: jobId },
        include: { sources: true },
      });

      if (!bootstrapJob) {
        throw new Error(`Job ${jobId} not found after auth probing`);
      }

      // 4. VALIDATING
      await this.transitionState(jobId, 'VALIDATING');
      let workingProcesses = parsedProcesses;
      let validationSummary = await this.runValidation(bootstrapJob, workingProcesses, {
        reportId,
        evidenceType: 'deep_validation',
        evidenceLabel: 'Initial validation',
      });

      if (validationSummary.failedCount + validationSummary.partialCount > 0) {
        const selfHealingResult = await this.runSelfHealing(
          bootstrapJob,
          apiDoc,
          workingProcesses,
          validationSummary,
          reportId,
        );
        workingProcesses = selfHealingResult.processes;
        validationSummary = selfHealingResult.validationSummary;
      }

      // 5. NORMALIZING
      await this.transitionState(jobId, 'NORMALIZING');
      await this.runNormalization(jobId, workingProcesses, validationSummary.validationResults, reportId);

      const failedProcessCodes = validationSummary.validationResults
        .filter((result) => result.overall !== 'passed')
        .map((result) => result.processCode);

      if (validationSummary.passedProcesses.length === 0) {
        await this.disableArtifactsForFailedProcesses(bootstrapJob, failedProcessCodes);
        await this.transitionState(jobId, 'VALIDATION_FAILED', {
          completedAt: new Date(),
          lastError: '接口验证未通过，未注册到 MCP',
        });
        await this.prisma.adapterBuild.create({
          data: {
            bootstrapJobId: jobId,
            adapterType: 'mcp',
            generatedCode: '// Validation failed: no flows were eligible for MCP registration',
            buildStatus: 'failed',
            buildLog: JSON.stringify(validationSummary.validationResults),
          },
        });
        return { success: false, reason: 'validation_failed' };
      }

      // 6. COMPILING (包含 MCP Generation + Publishing)
      await this.transitionState(jobId, 'COMPILING');
      const finalStatus = validationSummary.passedProcesses.length === workingProcesses.length
        ? 'PUBLISHED'
        : 'PARTIALLY_PUBLISHED';
      await this.runCompiling(
        bootstrapJob,
        validationSummary.passedProcesses,
        finalStatus,
        failedProcessCodes,
      );

      this.logger.log(`Job ${jobId} completed successfully`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Job ${jobId} failed: ${error.message}`, error.stack);
      recordRuntimeDiagnostic({
        source: 'worker',
        category: 'system',
        eventType: 'worker_error',
        level: 'error',
        scope: 'bootstrap.handleBootstrap',
        message: error.message,
        data: {
          jobId,
          queueJobId,
          stack: error.stack,
        },
      });
      await this.transitionState(jobId, 'FAILED', {
        completedAt: new Date(),
        lastError: error.message || 'Bootstrap pipeline failed',
      }).catch(() => {});
      throw error;
    } finally {
      stopHeartbeat?.();
    }
  }

  // ============================================================
  // DISCOVERY 阶段
  // ============================================================

  private async runDiscovery(bootstrapJob: any): Promise<string | null> {
    this.logger.log(`Running discovery for ${bootstrapJob.oaUrl || 'uploaded doc'}`);

    // 1. 优先使用上传的文档内容
    const docSource = bootstrapJob.sources.find(
      (s: any) => s.sourceContent && ['openapi', 'swagger', 'custom'].includes(s.sourceType),
    );

    if (docSource?.sourceContent) {
      this.logger.log(`Using inline API doc (${docSource.sourceType})`);
      let enrichedContent = docSource.sourceContent;

      // 如果有 OA URL 和认证信息，尝试拉取真实表单数据丰富文档
      if (bootstrapJob.oaUrl && bootstrapJob.authConfig) {
        enrichedContent = await this.enrichWithLiveFormData(
          docSource.sourceContent,
          bootstrapJob.oaUrl,
          bootstrapJob.authConfig,
        );
      }

      return enrichedContent;
    }

    // 2. 尝试从 URL 获取文档
    const openApiSource = bootstrapJob.sources.find(
      (s: any) => s.sourceType === 'openapi' && s.sourceUrl,
    );

    if (openApiSource?.sourceUrl) {
      try {
        const response = await axios.get(openApiSource.sourceUrl, { timeout: 30000 });
        const content = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data, null, 2);
        this.logger.log(`Fetched API doc from URL (${content.length} chars)`);
        return content;
      } catch (error: any) {
        this.logger.warn(`Failed to fetch API doc: ${error.message}`);
      }
    }

    this.logger.warn(`No API doc found for job ${bootstrapJob.id}`);
    return null;
  }

  /**
   * 从 OA 系统拉取真实流程模板数据，合并到 API 文档中
   */
  private async enrichWithLiveFormData(
    documentContent: string,
    oaUrl: string,
    authConfig: any,
  ): Promise<string> {
    this.logger.log(`Attempting to enrich doc with live form data from ${oaUrl}`);

    try {
      const auth = authConfig || {};

      if (!auth.username || !auth.password) {
        this.logger.warn('username or password not configured in authConfig, skipping enrichment');
        return documentContent;
      }

      // 1. 登录获取 session（复用 loginForCookie 的缓存逻辑）
      const cookieHeader = await this.loginForCookie(oaUrl, auth);
      if (!cookieHeader) {
        this.logger.warn('Failed to get cookie session, skipping enrichment');
        return documentContent;
      }

      // 2. 拉取流程模板列表
      const formsPath = auth.formsPath || this.findFormsEndpointPath(documentContent);
      if (!formsPath) {
        this.logger.warn('No forms endpoint detected from API document, skipping enrichment');
        return documentContent;
      }
      const formsRes = await axios.get(buildFullUrl(oaUrl, formsPath), {
        timeout: 10000,
        headers: { Cookie: cookieHeader },
        validateStatus: () => true,
      });

      if (formsRes.status >= 400 || !formsRes.data?.forms) {
        this.logger.warn('Forms endpoint not available or returned no data');
        return documentContent;
      }

      const forms = formsRes.data.forms;
      if (!Array.isArray(forms) || forms.length === 0) {
        return documentContent;
      }

      this.logger.log(`Fetched ${forms.length} form templates from OA system`);

      // 3. 将流程模板数据追加到文档内容中
      const formsSection = `

=== OA 系统实际流程模板数据（来自 ${formsPath} 接口的真实返回） ===
以下是 OA 系统中实际注册的所有流程模板，每个流程通过统一接口提交，
使用 formCode 字段区分不同流程类型。请为每个流程模板都生成对应的 process 定义。

${JSON.stringify(forms, null, 2)}

=== 重要说明 ===
- 上面每个 form 对象就是一个独立的业务流程
- formCode 对应 processCode（需转为大写下划线格式）
- fields 数组包含了每个流程的完整字段定义
- workflow 数组包含了审批流程步骤
- 请确保为每一个 form 都生成对应的 process，不要遗漏
`;

      return documentContent + formsSection;
    } catch (error: any) {
      this.logger.warn(`Failed to enrich with live form data: ${error.message}`);
      return documentContent;
    }
  }

  // ============================================================
  // PARSING 阶段
  // ============================================================

  private async runParsing(bootstrapJob: any, apiDoc: string | null): Promise<BusinessProcess[]> {
    if (!apiDoc) {
      this.logger.log(`No API doc found, skipping parsing`);
      return [];
    }

    this.logger.log(`Analyzing API documentation with LLM Agent`);
    const baseUrl = this.resolveBaseUrl(bootstrapJob);

    const result = await this.apiAnalyzer.execute(
      { docContent: apiDoc, oaUrl: bootstrapJob.oaUrl ?? undefined, baseUrl },
      { tenantId: bootstrapJob.tenantId, traceId: bootstrapJob.id },
    );

    if (!result.success || !result.data) {
      this.logger.error(`API Analyzer failed: ${result.error}`);
      return [];
    }

    this.logger.log(
      `Identified ${result.data.processes.length} business processes, ${result.data.totalEndpoints} endpoints`,
    );
    return result.data.processes;
  }

  // ============================================================
  // AUTH_PROBING 阶段 — 自动探测认证方式
  // ============================================================

  private async runAuthProbing(
    bootstrapJob: any,
    processes: BusinessProcess[],
    apiDoc: string | null,
  ): Promise<void> {
    const baseUrl = this.resolveBaseUrl(bootstrapJob);
    if (!baseUrl || baseUrl === 'http://localhost') {
      this.logger.warn('No valid baseUrl, skipping auth probing');
      return;
    }

    const userAuth = (bootstrapJob.authConfig as Record<string, any>) || {};

    // 如果用户已经明确指定了 authType 且有完整凭证，跳过探测
    if (userAuth.authType && this.hasCredentials(userAuth)) {
      this.logger.log(`Auth type already specified: ${userAuth.authType}, skipping probing`);
      return;
    }

    this.logger.log('Starting auth probing...');
    const probeLog: string[] = [];

    // 1. 从 API 文档中提取 authHint 和 loginEndpoints
    const authHint = this.extractAuthHint(apiDoc);
    const loginEndpoints = this.findLoginEndpoints(processes, apiDoc);
    probeLog.push(`authHint: ${JSON.stringify(authHint)}`);
    probeLog.push(`loginEndpoints: ${loginEndpoints.map(e => `${e.method} ${e.path}`).join(', ') || 'none'}`);

    // 2. 先尝试无认证访问
    const probeTargets = this.buildNoAuthProbeTargets(baseUrl, processes, apiDoc, userAuth);
    probeLog.push(`probeTargets: ${probeTargets.join(', ') || 'none'}`);
    const noAuthResult = await this.probeNoAuth(probeTargets);
    if (noAuthResult) {
      probeLog.push(`No auth required — direct access works on ${noAuthResult}`);
      await this.updateAuthConfig(bootstrapJob.id, { ...userAuth, authType: 'none' }, probeLog);
      return;
    }

    // 3. 如果有 authHint，优先按提示探测
    if (authHint?.type && userAuth.token) {
      const hintResult = await this.probeWithHint(baseUrl, authHint, userAuth);
      if (hintResult) {
        probeLog.push(`authHint probe succeeded: ${hintResult.authType}, header=${hintResult.headerName}`);
        await this.updateAuthConfig(bootstrapJob.id, { ...userAuth, ...hintResult }, probeLog);
        return;
      }
      probeLog.push('authHint probe failed, falling back to login probing');
    }

    // 4. 用 loginEndpoints 尝试登录
    if (userAuth.username && userAuth.password && loginEndpoints.length > 0) {
      for (const ep of loginEndpoints) {
        const loginUrl = buildFullUrl(baseUrl, ep.path);
        probeLog.push(`Trying login: POST ${loginUrl}`);

        const loginResult = await this.probeLogin(baseUrl, loginUrl, userAuth.username, userAuth.password);
        if (loginResult) {
          probeLog.push(`Login probe succeeded: ${loginResult.authType}`);
          await this.updateAuthConfig(bootstrapJob.id, {
            ...userAuth,
            ...loginResult,
            loginPath: ep.path,
          }, probeLog);
          return;
        }
        probeLog.push(`Login probe failed for ${ep.path}`);
      }
    }

    // 5. 尝试 Basic Auth
    if (userAuth.username && userAuth.password) {
      probeLog.push('Trying Basic Auth');
      const basicResult = await this.probeBasicAuth(baseUrl, userAuth.username, userAuth.password);
      if (basicResult) {
        probeLog.push('Basic Auth probe succeeded');
        await this.updateAuthConfig(bootstrapJob.id, {
          ...userAuth,
          authType: 'basic',
        }, probeLog);
        return;
      }
      probeLog.push('Basic Auth probe failed');
    }

    // 6. 如果用户提供了 token，尝试各种 header 携带方式
    if (userAuth.token) {
      probeLog.push('Trying token with various headers');
      const tokenResult = await this.probeTokenHeaders(baseUrl, userAuth.token);
      if (tokenResult) {
        probeLog.push(`Token probe succeeded: header=${tokenResult.headerName}`);
        await this.updateAuthConfig(bootstrapJob.id, {
          ...userAuth,
          ...tokenResult,
        }, probeLog);
        return;
      }
      probeLog.push('Token probe failed');
    }

    // 7. 全部失败
    probeLog.push('All auth probing methods failed');
    this.logger.warn(`Auth probing failed for job ${bootstrapJob.id}`);

    // 保留用户原始配置，记录探测日志
    await this.updateAuthConfig(bootstrapJob.id, {
      ...userAuth,
      authType: userAuth.authType || 'unknown',
      _probeStatus: 'failed',
    }, probeLog);
  }

  // ── Auth probing helpers ────────────────────────────────────

  private hasCredentials(auth: Record<string, any>): boolean {
    return !!(auth.token || (auth.username && auth.password));
  }

  private extractAuthHint(apiDoc: string | null): { type?: string; headerName?: string } | null {
    if (!apiDoc) return null;
    try {
      const doc = JSON.parse(apiDoc.split('\n===')[0]); // 去掉 enrichment 部分
      const schemes = doc.components?.securitySchemes || doc.securityDefinitions || {};
      for (const [, scheme] of Object.entries(schemes)) {
        const s = scheme as any;
        if (s.type === 'oauth2') return { type: 'oauth2' };
        if (s.type === 'apiKey' && s.in === 'cookie') return { type: 'cookie', headerName: s.name };
        if (s.type === 'apiKey') return { type: 'apikey', headerName: s.name };
        if (s.type === 'http' && s.scheme === 'basic') return { type: 'basic' };
        if (s.type === 'http' && s.scheme === 'bearer') return { type: 'bearer' };
      }
    } catch {
      // not JSON or no security schemes
    }
    return null;
  }

  private findLoginEndpoints(
    processes: BusinessProcess[],
    apiDoc: string | null,
  ): Array<{ method: string; path: string }> {
    const results: Array<{ method: string; path: string }> = [];
    const seen = new Set<string>();

    // 从 LLM 解析的 processes 中找
    for (const proc of processes) {
      for (const ep of proc.endpoints) {
        if (this.isLoginEndpoint(ep.method, ep.path) && !seen.has(ep.path)) {
          results.push({ method: ep.method, path: ep.path });
          seen.add(ep.path);
        }
      }
    }

    // 从原始 API 文档的 paths 中找
    if (apiDoc) {
      try {
        const doc = JSON.parse(apiDoc.split('\n===')[0]);
        for (const [path, pathItem] of Object.entries(doc.paths || {})) {
          for (const method of Object.keys(pathItem as any)) {
            if (this.isLoginEndpoint(method, path) && !seen.has(path)) {
              results.push({ method: method.toUpperCase(), path });
              seen.add(path);
            }
          }
        }
      } catch {
        // not JSON
      }
    }

    // fallback 常见路径
    const fallbacks = ['/api/auth/login', '/api/login', '/login', '/auth/login', '/api/token', '/oauth/token'];
    for (const path of fallbacks) {
      if (!seen.has(path)) {
        results.push({ method: 'POST', path });
      }
    }

    return results;
  }

  private isLoginEndpoint(method: string, path: string): boolean {
    if (method.toUpperCase() !== 'POST') return false;
    const p = path.toLowerCase();
    return p.includes('/login')
      || p.includes('/signin')
      || p.includes('/auth/token')
      || p.includes('/oauth/token')
      || p.includes('/session');
  }

  private buildNoAuthProbeTargets(
    baseUrl: string,
    processes: BusinessProcess[],
    apiDoc: string | null,
    authConfig: Record<string, any>,
  ): string[] {
    const targets = new Set<string>();

    for (const process of processes) {
      for (const endpoint of process.endpoints) {
        if (endpoint.method === 'GET' && !endpoint.path.includes('{')) {
          targets.add(buildFullUrl(baseUrl, endpoint.path));
        }
      }
    }

    if (authConfig.formsPath) {
      targets.add(buildFullUrl(baseUrl, authConfig.formsPath));
    }

    targets.add(buildFullUrl(baseUrl, '/api/forms'));
    targets.add(buildFullUrl(baseUrl, '/api/applications'));

    if (apiDoc) {
      try {
        const doc = JSON.parse(apiDoc.split('\n===')[0]);
        for (const [path, pathItem] of Object.entries(doc.paths || {})) {
          if (path.includes('{')) continue;
          if (!this.isCandidateBusinessPath(path)) continue;
          const hasGet = !!(pathItem as any)?.get;
          if (hasGet) {
            targets.add(buildFullUrl(baseUrl, path));
          }
        }
      } catch {
        // ignore non-JSON doc
      }
    }

    return Array.from(targets);
  }

  private async probeNoAuth(targets: string[]): Promise<string | null> {
    for (const target of targets) {
      try {
        const resp = await axios.get(target, { timeout: 5000, validateStatus: () => true });
        if (resp.status === 401 || resp.status === 403) {
          return null;
        }

        const contentType = String(resp.headers['content-type'] || '').toLowerCase();
        const isHtml = contentType.includes('text/html') || this.looksLikeHtmlPage(resp.data);
        if (resp.status >= 200 && resp.status < 300 && !isHtml) {
          return target;
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  private isCandidateBusinessPath(path: string): boolean {
    const lower = path.toLowerCase();
    if (lower.includes('{')) return false;
    if (/(auth|login|logout|health|metrics|swagger|docs|admin|config|system)/i.test(lower)) {
      return false;
    }
    return /(form|application|request|submission|workflow|process)/i.test(lower);
  }

  private looksLikeHtmlPage(data: any): boolean {
    return typeof data === 'string' && /<html|<!doctype html/i.test(data);
  }

  private async probeWithHint(
    baseUrl: string,
    hint: { type?: string; headerName?: string },
    userAuth: Record<string, any>,
  ): Promise<{ authType: string; headerName?: string; headerPrefix?: string } | null> {
    const token = userAuth.token;
    if (!token) return null;

    const attempts: Array<{ headerName: string; headerValue: string; authType: string; headerPrefix?: string }> = [];

    if (hint.type === 'bearer') {
      attempts.push({ headerName: 'Authorization', headerValue: `Bearer ${token}`, authType: 'bearer', headerPrefix: 'Bearer ' });
    } else if (hint.type === 'apikey' && hint.headerName) {
      attempts.push({ headerName: hint.headerName, headerValue: token, authType: 'apikey' });
    }

    for (const attempt of attempts) {
      try {
        const resp = await axios.get(baseUrl, {
          timeout: 5000,
          headers: { [attempt.headerName]: attempt.headerValue },
          validateStatus: () => true,
        });
        if (resp.status >= 200 && resp.status < 400) {
          return { authType: attempt.authType, headerName: attempt.headerName, headerPrefix: attempt.headerPrefix };
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  private async probeLogin(
    baseUrl: string,
    loginUrl: string,
    username: string,
    password: string,
  ): Promise<{ authType: string; headerName?: string; headerPrefix?: string; token?: string } | null> {
    try {
      const resp = await axios.post(
        loginUrl,
        { username, password },
        { timeout: 10000, validateStatus: () => true },
      );

      if (resp.status >= 400) return null;

      // Case A: Set-Cookie → cookie 模式
      const setCookies = resp.headers['set-cookie'];
      if (setCookies && setCookies.length > 0) {
        // 验证 cookie 是否有效
        const cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');
        const verifyResp = await axios.get(baseUrl, {
          timeout: 5000,
          headers: { Cookie: cookie },
          validateStatus: () => true,
        });
        if (verifyResp.status >= 200 && verifyResp.status < 400) {
          return { authType: 'cookie' };
        }
      }

      // Case B: 响应 body 中有 token
      const body = resp.data;
      const token = this.extractTokenFromBody(body);
      if (token) {
        // 尝试各种 header 携带方式
        const headerResult = await this.probeTokenHeaders(baseUrl, token);
        if (headerResult) {
          return { ...headerResult, token };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private extractTokenFromBody(body: any): string | null {
    if (!body || typeof body !== 'object') return null;

    // 直接字段
    const directFields = ['token', 'access_token', 'accessToken', 'sessionId', 'session_id', 'jwt'];
    for (const field of directFields) {
      if (typeof body[field] === 'string' && body[field].length > 0) {
        return body[field];
      }
    }

    // 嵌套在 data 字段中
    const data = body.data || body.result || body.response;
    if (data && typeof data === 'object') {
      for (const field of directFields) {
        if (typeof data[field] === 'string' && data[field].length > 0) {
          return data[field];
        }
      }
    }

    return null;
  }

  private async probeTokenHeaders(
    baseUrl: string,
    token: string,
  ): Promise<{ authType: string; headerName: string; headerPrefix?: string } | null> {
    const attempts = [
      { headerName: 'Authorization', headerValue: `Bearer ${token}`, authType: 'bearer', headerPrefix: 'Bearer ' },
      { headerName: 'x-token', headerValue: token, authType: 'apikey' },
      { headerName: 'Authorization', headerValue: token, authType: 'apikey' },
      { headerName: 'X-API-Key', headerValue: token, authType: 'apikey' },
      { headerName: 'X-Access-Token', headerValue: token, authType: 'apikey' },
    ];

    for (const attempt of attempts) {
      try {
        const resp = await axios.get(baseUrl, {
          timeout: 5000,
          headers: { [attempt.headerName]: attempt.headerValue },
          validateStatus: () => true,
        });
        if (resp.status >= 200 && resp.status < 400) {
          return { authType: attempt.authType, headerName: attempt.headerName, headerPrefix: attempt.headerPrefix };
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  private async probeBasicAuth(baseUrl: string, username: string, password: string): Promise<boolean> {
    try {
      const resp = await axios.get(baseUrl, {
        timeout: 5000,
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        },
        validateStatus: () => true,
      });
      return resp.status >= 200 && resp.status < 400;
    } catch {
      return false;
    }
  }

  private async updateAuthConfig(
    jobId: string,
    authConfig: Record<string, any>,
    probeLog: string[],
  ): Promise<void> {
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        authConfig: { ...authConfig, _probeLog: probeLog },
      },
    });
    this.logger.log(`Auth config updated for job ${jobId}: authType=${authConfig.authType}`);
  }

  // ============================================================
  // VALIDATING 阶段 — 深度验证
  // ============================================================

  private async runValidation(
    bootstrapJob: any,
    processes: BusinessProcess[],
    options: ValidationOptions = {},
  ): Promise<ValidationSummary> {
    if (processes.length === 0) {
      this.logger.log('No processes to validate');
      return {
        validationResults: [],
        passedProcesses: [],
        passedCount: 0,
        partialCount: 0,
        failedCount: 0,
      };
    }

    const baseUrl = this.resolveBaseUrl(bootstrapJob);
    if (!baseUrl || baseUrl === 'http://localhost') {
      this.logger.warn('No valid baseUrl available, skipping validation');
      const validationResults = processes.map<ProcessValidationResult>((process) => ({
        processCode: process.processCode,
        overall: 'failed',
        failureType: 'no_base_url',
        repairable: false,
        reason: 'No valid baseUrl available for validation',
      }));
      const summary = this.summarizeValidationResults(processes, validationResults);
      if (options.reportId) {
        await this.appendReportEvidence(options.reportId, [{
          type: options.evidenceType || 'deep_validation',
          description: `${options.evidenceLabel || 'Validation'}: ${summary.passedCount} passed, ${summary.partialCount} partial, ${summary.failedCount} failed`,
          passed: summary.passedCount,
          partial: summary.partialCount,
          failed: summary.failedCount,
          details: validationResults as any,
          timestamp: new Date().toISOString(),
        }]);
      }
      return summary;
    }

    const authConfig = bootstrapJob.authConfig || {};
    this.logger.log(`Deep validating ${processes.length} processes`);

    const validationResults: ProcessValidationResult[] = [];

    // 为 cookie auth 预先登录获取 session
    let cookieSession: string | undefined;
    if (authConfig.authType === 'cookie') {
      cookieSession = await this.loginForCookie(baseUrl, authConfig);
    }

    for (const process of processes) {
      const result = await this.validateProcess(
        baseUrl,
        process,
        authConfig,
        cookieSession,
      );
      validationResults.push(result);
    }

    const summary = this.summarizeValidationResults(processes, validationResults);

    if (options.reportId) {
      await this.appendReportEvidence(options.reportId, [{
        type: options.evidenceType || 'deep_validation',
        description: `${options.evidenceLabel || 'Validation'}: ${summary.passedCount} passed, ${summary.partialCount} partial, ${summary.failedCount} failed`,
        passed: summary.passedCount,
        partial: summary.partialCount,
        failed: summary.failedCount,
        details: validationResults as any,
        timestamp: new Date().toISOString(),
      }]);
    }

    this.logger.log(
      `Validation complete: ${summary.passedCount} passed, ${summary.partialCount} partial, ${summary.failedCount} failed. ` +
      `${summary.passedProcesses.length}/${processes.length} processes retained for MCP registration`,
    );

    return summary;
  }

  private async runSelfHealing(
    bootstrapJob: any,
    apiDoc: string | null,
    processes: BusinessProcess[],
    validationSummary: ValidationSummary,
    reportId: string,
  ): Promise<{ processes: BusinessProcess[]; validationSummary: ValidationSummary }> {
    if (!apiDoc) {
      return { processes, validationSummary };
    }

    const currentProcesses = processes.map((process) => this.cloneProcess(process));
    const validationByFlow = new Map(
      validationSummary.validationResults.map((result) => [result.processCode, { ...result }]),
    );

    const existingAttempts = await this.prisma.bootstrapRepairAttempt.findMany({
      where: { bootstrapJobId: bootstrapJob.id },
      select: { flowCode: true, attemptNo: true },
    });
    const attemptCountByFlow = new Map<string, number>();
    for (const attempt of existingAttempts) {
      const current = attemptCountByFlow.get(attempt.flowCode) || 0;
      attemptCountByFlow.set(attempt.flowCode, Math.max(current, attempt.attemptNo));
    }

    const baseUrl = this.resolveBaseUrl(bootstrapJob);
    const authConfig = bootstrapJob.authConfig || {};
    let cookieSession: string | undefined;

    for (let round = 1; round <= MAX_SELF_HEAL_ATTEMPTS; round++) {
      const targets = currentProcesses
        .map((process) => ({
          process,
          validation: validationByFlow.get(process.processCode),
          attempts: attemptCountByFlow.get(process.processCode) || 0,
        }))
        .filter((item) =>
          item.validation &&
          item.validation.overall !== 'passed' &&
          item.attempts < MAX_SELF_HEAL_ATTEMPTS &&
          this.shouldAttemptAutoRepair(item.validation),
        );

      if (targets.length === 0) {
        break;
      }

      await this.transitionState(bootstrapJob.id, 'SELF_HEALING');

      const roundEvidence: Array<Record<string, any>> = [];
      let attemptedRepairs = 0;
      let revalidatingStarted = false;

      for (const target of targets) {
        const currentValidation = target.validation!;
        const attemptNo = (attemptCountByFlow.get(target.process.processCode) || 0) + 1;
        attemptCountByFlow.set(target.process.processCode, attemptNo);
        attemptedRepairs++;

        const agentResult = await this.bootstrapRepairAgent.execute(
          {
            docContent: apiDoc,
            baseUrl,
            failureType: currentValidation.failureType || 'unknown',
            process: this.cloneProcess(target.process),
            validationResult: currentValidation as any,
          },
          {
            tenantId: bootstrapJob.tenantId,
            traceId: `${bootstrapJob.id}:repair:${target.process.processCode}:${attemptNo}`,
          },
        );

        const baseAttempt = {
          bootstrapJobId: bootstrapJob.id,
          flowCode: target.process.processCode,
          attemptNo,
          triggerReason: currentValidation.failureType || 'unknown',
        };

        if (!agentResult.success || !agentResult.data) {
          await this.prisma.bootstrapRepairAttempt.create({
            data: {
              ...baseAttempt,
              status: 'failed',
              result: { validationResult: currentValidation } as any,
              errorMessage: agentResult.error || 'LLM repair failed',
            },
          });
          roundEvidence.push({
            flowCode: target.process.processCode,
            attemptNo,
            status: 'failed',
            reason: agentResult.error || 'LLM repair failed',
          });
          continue;
        }

        const proposal = agentResult.data;
        if (!proposal.repairable || !proposal.updatedProcess) {
          await this.prisma.bootstrapRepairAttempt.create({
            data: {
              ...baseAttempt,
              status: 'skipped',
              confidence: proposal.confidence,
              proposedPatch: proposal as any,
              result: { validationResult: currentValidation } as any,
              errorMessage: proposal.summary,
            },
          });
          roundEvidence.push({
            flowCode: target.process.processCode,
            attemptNo,
            status: 'skipped',
            reason: proposal.summary,
          });
          continue;
        }

        const sanitized = this.sanitizeRepairedProcess(
          target.process,
          proposal.updatedProcess,
          apiDoc,
        );
        if (!sanitized.accepted || !sanitized.process) {
          await this.prisma.bootstrapRepairAttempt.create({
            data: {
              ...baseAttempt,
              status: 'rejected',
              confidence: proposal.confidence,
              proposedPatch: proposal as any,
              errorMessage: sanitized.reason || 'Rejected unsafe repair patch',
            },
          });
          roundEvidence.push({
            flowCode: target.process.processCode,
            attemptNo,
            status: 'rejected',
            reason: sanitized.reason || 'Rejected unsafe repair patch',
          });
          continue;
        }

        if (!revalidatingStarted) {
          await this.transitionState(bootstrapJob.id, 'REVALIDATING');
          revalidatingStarted = true;
          if (authConfig.authType === 'cookie') {
            cookieSession = await this.loginForCookie(baseUrl, authConfig);
          }
        }

        const nextValidation = await this.validateProcess(
          baseUrl,
          sanitized.process,
          authConfig,
          cookieSession,
        );
        const adopted = this.shouldAdoptRepair(currentValidation, nextValidation);
        if (adopted) {
          const processIndex = currentProcesses.findIndex(
            (process) => process.processCode === target.process.processCode,
          );
          if (processIndex >= 0) {
            currentProcesses[processIndex] = sanitized.process;
          }
          validationByFlow.set(target.process.processCode, nextValidation);
        }

        const status: RepairAttemptStatus = nextValidation.overall === 'passed' ? 'fixed' : 'failed';
        await this.prisma.bootstrapRepairAttempt.create({
          data: {
            ...baseAttempt,
            status,
            confidence: proposal.confidence,
            proposedPatch: proposal as any,
            appliedPatch: {
              summary: proposal.summary,
              changedFields: sanitized.changedFields,
              adopted,
            } as any,
            result: {
              adopted,
              validationResult: nextValidation,
            } as any,
            errorMessage: adopted ? null : 'Repair did not improve validation outcome',
          },
        });
        roundEvidence.push({
          flowCode: target.process.processCode,
          attemptNo,
          status,
          adopted,
          summary: proposal.summary,
          validation: nextValidation,
        });
      }

      const nextSummary = this.summarizeValidationResults(
        currentProcesses,
        currentProcesses
          .map((process) => validationByFlow.get(process.processCode))
          .filter((result): result is ProcessValidationResult => !!result),
      );

      await this.appendReportEvidence(reportId, [{
        type: 'self_heal_round',
        round,
        attemptedRepairs,
        description: `Self-healing round ${round}: ${nextSummary.passedCount} passed, ${nextSummary.partialCount} partial, ${nextSummary.failedCount} failed`,
        details: roundEvidence as any,
        timestamp: new Date().toISOString(),
      }]);

      validationSummary = nextSummary;
      if (validationSummary.failedCount + validationSummary.partialCount === 0) {
        break;
      }

      if (!revalidatingStarted) {
        break;
      }
    }

    return {
      processes: currentProcesses,
      validationSummary,
    };
  }

  private summarizeValidationResults(
    processes: BusinessProcess[],
    validationResults: ProcessValidationResult[],
  ): ValidationSummary {
    const byCode = new Map(validationResults.map((result) => [result.processCode, result]));
    const passedProcesses = processes.filter((process) => byCode.get(process.processCode)?.overall === 'passed');
    const passedCount = validationResults.filter((result) => result.overall === 'passed').length;
    const partialCount = validationResults.filter((result) => result.overall === 'partial').length;
    const failedCount = validationResults.filter((result) => result.overall === 'failed').length;

    return {
      validationResults,
      passedProcesses,
      passedCount,
      partialCount,
      failedCount,
    };
  }

  private shouldAttemptAutoRepair(validation: ProcessValidationResult): boolean {
    return !!validation.failureType && REPAIRABLE_FAILURE_TYPES.has(validation.failureType);
  }

  private shouldAdoptRepair(
    previous: ProcessValidationResult,
    next: ProcessValidationResult,
  ): boolean {
    return this.scoreValidation(next) >= this.scoreValidation(previous);
  }

  private scoreValidation(result: ProcessValidationResult): number {
    const overallScore = result.overall === 'passed'
      ? 3
      : result.overall === 'partial'
        ? 2
        : 1;
    const responseScore = result.submit?.responseStructureValid ? 0.4 : 0;
    const purposeScore = result.submit?.purposeMatch ? 0.2 : 0;
    const paramScore = typeof result.paramStructure?.confidence === 'number'
      ? Math.min(result.paramStructure.confidence, 1) * 0.2
      : 0;
    const endpointChecks = result.endpointChecks || [];
    const passedEndpointChecks = endpointChecks.filter((check) => check.status === 'passed').length;
    const endpointScore = endpointChecks.length > 0
      ? (passedEndpointChecks / endpointChecks.length) * 0.3
      : 0;
    return overallScore + responseScore + purposeScore + paramScore + endpointScore;
  }

  private mapSubmitFailureType(failureReason?: string): ValidationFailureType {
    switch (failureReason) {
      case 'param_error':
        return 'param_error';
      case 'auth_failed':
        return 'auth_failed';
      case 'not_found':
        return 'endpoint_not_found';
      case 'server_error':
        return 'server_error';
      case 'network_error':
        return 'network_unreachable';
      default:
        return 'unknown';
    }
  }

  /**
   * 验证单个流程
   */
  private async validateProcess(
    baseUrl: string,
    process: BusinessProcess,
    authConfig: any,
    cookieSession?: string,
  ): Promise<ProcessValidationResult> {
    const submitEndpoint = process.endpoints.find((ep) => ep.category === 'submit');
    const queryEndpoint = process.endpoints.find((ep) => ep.category === 'query');
    const cancelEndpoint = process.endpoints.find((ep) => ep.category === 'cancel');
    const endpointChecks: EndpointProbeResult[] = [];
    if (!submitEndpoint) {
      return {
        processCode: process.processCode,
        overall: 'failed',
        failureType: 'missing_submit',
        repairable: true,
        endpointChecks,
        reason: 'No submit endpoint',
      };
    }

    // Level 1: 参数结构验证
    const paramValidation = await this.validateParamStructure(
      baseUrl,
      submitEndpoint,
      process,
      authConfig,
      cookieSession,
    );

    // Level 2: 真实提交验证
    const submitValidation = await this.validateRealSubmit(
      baseUrl,
      submitEndpoint,
      process,
      authConfig,
      cookieSession,
    );
    endpointChecks.push(this.buildSubmitEndpointCheck(submitEndpoint, submitValidation));

    // Level 3: 查询和辅助端点验证
    let queryValidation = null;
    let cancelValidation = null;

    if (submitValidation.success && submitValidation.submissionId && queryEndpoint) {
      queryValidation = await this.validateQuery(
        baseUrl,
        queryEndpoint,
        submitValidation.submissionId,
        authConfig,
        cookieSession,
      );
      endpointChecks.push(this.buildQueryEndpointCheck(queryEndpoint, queryValidation));
    } else if (queryEndpoint) {
      endpointChecks.push({
        endpointName: queryEndpoint.name,
        category: queryEndpoint.category || 'query',
        method: queryEndpoint.method,
        path: queryEndpoint.path,
        status: 'failed',
        checkedWith: 'core_validation',
        reachable: false,
        usable: false,
        failureType: 'missing_submit',
        reason: 'Cannot validate query endpoint without a successful submit result',
      });
    }

    endpointChecks.push(...await this.probeSupplementalEndpoints(
      baseUrl,
      process,
      submitEndpoint,
      submitValidation.success ? submitValidation.submissionId : undefined,
      authConfig,
      cookieSession,
    ));

    if (submitValidation.success && submitValidation.submissionId && cancelEndpoint) {
      cancelValidation = await this.validateCancel(
        baseUrl,
        cancelEndpoint,
        submitValidation.submissionId,
        authConfig,
        cookieSession,
      );
      endpointChecks.push(this.buildCancelEndpointCheck(cancelEndpoint, cancelValidation));
    } else if (cancelEndpoint) {
      endpointChecks.push({
        endpointName: cancelEndpoint.name,
        category: cancelEndpoint.category || 'cancel',
        method: cancelEndpoint.method,
        path: cancelEndpoint.path,
        status: 'failed',
        checkedWith: 'core_validation',
        reachable: false,
        usable: false,
        failureType: 'missing_submit',
        reason: 'Cannot validate cancel endpoint without a successful submit result',
      });
    }

    const responseStructureInvalid =
      submitValidation.success && submitValidation.responseStructureValid === false;

    let overall: ValidationOverall;
    let failureType: ValidationFailureType | undefined;
    let reason: string | undefined;

    if (!submitValidation.success) {
      overall = submitValidation.failureReason === 'param_error' ? 'partial' : 'failed';
      failureType = paramValidation.confidence < 0.3
        ? 'mapping_error'
        : this.mapSubmitFailureType(submitValidation.failureReason);
      reason = paramValidation.confidence < 0.3
        ? 'Parameter structure mismatch'
        : submitValidation.error || submitValidation.failureReason || 'Submit validation failed';
    } else if (responseStructureInvalid) {
      overall = 'partial';
      failureType = 'mapping_error';
      reason = 'Response structure mismatch';
    } else if (queryEndpoint && (!queryValidation?.success || !queryValidation?.statusFound)) {
      overall = queryValidation?.success ? 'partial' : 'failed';
      failureType = queryValidation?.success
        ? 'mapping_error'
        : queryValidation?.failureType || 'unknown';
      reason = queryValidation?.success
        ? 'Query endpoint returned success but no status field was found'
        : queryValidation?.reason || 'Query validation failed';
    } else if (cancelEndpoint && !cancelValidation?.success) {
      overall = 'failed';
      failureType = cancelValidation?.failureType || 'unknown';
      reason = cancelValidation?.reason || 'Cancel validation failed';
    } else {
      const supplementalFailure = this.summarizeEndpointProbeFailures(endpointChecks);
      if (supplementalFailure) {
        overall = supplementalFailure.overall;
        failureType = supplementalFailure.failureType;
        reason = supplementalFailure.reason;
      } else {
        overall = 'passed';
      }
    }

    return {
      processCode: process.processCode,
      overall,
      failureType,
      repairable: failureType ? REPAIRABLE_FAILURE_TYPES.has(failureType) : false,
      paramStructure: paramValidation,
      submit: submitValidation,
      query: queryValidation,
      cancel: cancelValidation,
      endpointChecks,
      reason,
    };
  }

  private buildSubmitEndpointCheck(
    endpoint: Endpoint,
    validation: {
      success: boolean;
      statusCode?: number;
      responseStructureValid: boolean;
      purposeMatch: boolean;
      failureReason?: 'param_error' | 'auth_failed' | 'not_found' | 'server_error' | 'network_error';
      error?: string;
    },
  ): EndpointProbeResult {
    const failureType = !validation.success
      ? this.mapSubmitFailureType(validation.failureReason)
      : validation.responseStructureValid === false
        ? 'mapping_error'
        : validation.purposeMatch === false
          ? 'purpose_mismatch'
          : undefined;

    return {
      endpointName: endpoint.name,
      category: endpoint.category || 'submit',
      method: endpoint.method,
      path: endpoint.path,
      status: validation.success && validation.responseStructureValid !== false && validation.purposeMatch !== false
        ? 'passed'
        : 'failed',
      checkedWith: 'core_validation',
      reachable: validation.success || !!validation.statusCode || failureType !== 'network_unreachable',
      usable: validation.success && validation.responseStructureValid !== false && validation.purposeMatch !== false,
      statusCode: validation.statusCode ?? null,
      responseStructureValid: validation.responseStructureValid,
      failureType,
      reason: !validation.success
        ? validation.error || validation.failureReason || 'Submit validation failed'
        : validation.responseStructureValid === false
          ? 'Submit endpoint returned success but response mapping is invalid'
          : validation.purposeMatch === false
            ? 'Submit endpoint returned success but response purpose does not match the process'
            : null,
    };
  }

  private buildQueryEndpointCheck(
    endpoint: Endpoint,
    validation: {
      success: boolean;
      statusFound: boolean;
      statusCode?: number;
      failureType?: ValidationFailureType;
      reason?: string;
    },
  ): EndpointProbeResult {
    const failureType = !validation.success
      ? validation.failureType || 'unknown'
      : validation.statusFound
        ? undefined
        : 'mapping_error';

    return {
      endpointName: endpoint.name,
      category: endpoint.category || 'query',
      method: endpoint.method,
      path: endpoint.path,
      status: validation.success && validation.statusFound ? 'passed' : 'failed',
      checkedWith: 'core_validation',
      reachable: validation.success || !!validation.statusCode || failureType !== 'network_unreachable',
      usable: validation.success && validation.statusFound,
      statusCode: validation.statusCode ?? null,
      statusFound: validation.statusFound,
      failureType,
      reason: validation.success && !validation.statusFound
        ? 'Query endpoint returned success but no status field was found'
        : validation.reason || null,
    };
  }

  private buildCancelEndpointCheck(
    endpoint: Endpoint,
    validation: {
      success: boolean;
      statusCode?: number;
      failureType?: ValidationFailureType;
      reason?: string;
    },
  ): EndpointProbeResult {
    return {
      endpointName: endpoint.name,
      category: endpoint.category || 'cancel',
      method: endpoint.method,
      path: endpoint.path,
      status: validation.success ? 'passed' : 'failed',
      checkedWith: 'core_validation',
      reachable: validation.success || !!validation.statusCode || validation.failureType !== 'network_unreachable',
      usable: validation.success,
      statusCode: validation.statusCode ?? null,
      failureType: validation.success ? undefined : validation.failureType || 'unknown',
      reason: validation.reason || null,
    };
  }

  private async probeSupplementalEndpoints(
    baseUrl: string,
    process: BusinessProcess,
    submitEndpoint: Endpoint,
    primarySubmissionId: string | undefined,
    authConfig: any,
    cookieSession?: string,
  ): Promise<EndpointProbeResult[]> {
    const results: EndpointProbeResult[] = [];
    const supplementalEndpoints = process.endpoints.filter(
      (endpoint) => !['submit', 'query', 'cancel'].includes(endpoint.category),
    );

    for (const endpoint of supplementalEndpoints) {
      let submissionId = primarySubmissionId;

      if (this.endpointNeedsFreshSubmission(endpoint)) {
        const probeSubmit = await this.validateRealSubmit(
          baseUrl,
          submitEndpoint,
          process,
          authConfig,
          cookieSession,
        );
        if (!probeSubmit.success || !probeSubmit.submissionId) {
          results.push({
            endpointName: endpoint.name,
            category: endpoint.category || 'other',
            method: endpoint.method,
            path: endpoint.path,
            status: 'failed',
            checkedWith: 'endpoint_probe',
            reachable: false,
            usable: false,
            statusCode: probeSubmit.statusCode ?? null,
            failureType: this.mapSubmitFailureType(probeSubmit.failureReason),
            reason: probeSubmit.error || 'Failed to create probe submission for endpoint validation',
          });
          continue;
        }
        submissionId = probeSubmit.submissionId;
      }

      results.push(await this.probeEndpoint(
        baseUrl,
        endpoint,
        authConfig,
        cookieSession,
        submissionId,
      ));
    }

    return results;
  }

  private endpointNeedsFreshSubmission(endpoint: Endpoint): boolean {
    if (endpoint.category === 'approve' || endpoint.category === 'urge') {
      return true;
    }

    return !['GET', 'HEAD', 'OPTIONS'].includes(endpoint.method.toUpperCase());
  }

  private async probeEndpoint(
    baseUrl: string,
    endpoint: Endpoint,
    authConfig: any,
    cookieSession: string | undefined,
    submissionId?: string,
  ): Promise<EndpointProbeResult> {
    const samples = this.buildEndpointProbeSamples(endpoint, submissionId);
    const resolvedPath = this.resolveEndpointPathWithSamples(endpoint.path, samples, submissionId);
    if (resolvedPath.unresolvedParams.length > 0) {
      return {
        endpointName: endpoint.name,
        category: endpoint.category || 'other',
        method: endpoint.method,
        path: endpoint.path,
        status: 'failed',
        checkedWith: 'endpoint_probe',
        reachable: false,
        usable: false,
        failureType: 'param_error',
        reason: `Missing path parameter context: ${resolvedPath.unresolvedParams.join(', ')}`,
      };
    }

    const url = new URL(buildFullUrl(baseUrl, resolvedPath.path));
    for (const param of endpoint.parameters || []) {
      if (param.in !== 'query') {
        continue;
      }
      const value = samples[param.name];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(param.name, String(item));
        }
      } else {
        url.searchParams.set(param.name, String(value));
      }
    }

    const headers = this.buildAuthHeaders(authConfig, cookieSession);
    const body = this.buildEndpointProbeBody(endpoint, samples);

    try {
      const response = await axios({
        method: endpoint.method.toLowerCase(),
        url: url.toString(),
        headers,
        data: body,
        timeout: ['GET', 'HEAD', 'OPTIONS'].includes(endpoint.method.toUpperCase()) ? 10000 : 15000,
        validateStatus: () => true,
      });

      const responseStructureValid = this.verifyResponseStructure(response.data, endpoint.responseMapping);
      const statusFound = endpoint.category === 'query' || endpoint.category === 'status_query'
        ? this.findStatusField(response.data)
        : null;
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html') || this.looksLikeHtmlPage(response.data);

      if (response.status >= 200 && response.status < 300 && !isHtml && responseStructureValid && statusFound !== false) {
        return {
          endpointName: endpoint.name,
          category: endpoint.category || 'other',
          method: endpoint.method,
          path: endpoint.path,
          status: 'passed',
          checkedWith: 'endpoint_probe',
          reachable: true,
          usable: true,
          statusCode: response.status,
          responseStructureValid,
          statusFound,
        };
      }

      let failureType = this.mapHttpStatusToFailureType(response.status);
      let reason = this.describeHttpFailure(response.status);
      if (isHtml) {
        failureType = 'server_error';
        reason = 'Endpoint returned HTML instead of API JSON response';
      } else if (!responseStructureValid) {
        failureType = 'mapping_error';
        reason = 'Endpoint returned success but response mapping validation failed';
      } else if (statusFound === false) {
        failureType = 'mapping_error';
        reason = 'Endpoint returned success but no status field was found';
      }

      return {
        endpointName: endpoint.name,
        category: endpoint.category || 'other',
        method: endpoint.method,
        path: endpoint.path,
        status: 'failed',
        checkedWith: 'endpoint_probe',
        reachable: response.status > 0,
        usable: false,
        statusCode: response.status,
        responseStructureValid,
        statusFound,
        failureType,
        reason,
      };
    } catch (error: any) {
      return {
        endpointName: endpoint.name,
        category: endpoint.category || 'other',
        method: endpoint.method,
        path: endpoint.path,
        status: 'failed',
        checkedWith: 'endpoint_probe',
        reachable: false,
        usable: false,
        statusCode: error.response?.status ?? null,
        failureType: 'network_unreachable',
        reason: error.message,
      };
    }
  }

  private buildEndpointProbeSamples(
    endpoint: Endpoint,
    submissionId?: string,
  ): Record<string, any> {
    const samples: Record<string, any> = {};

    for (const param of endpoint.parameters || []) {
      if (param.defaultValue !== undefined) {
        samples[param.name] = param.defaultValue;
        continue;
      }

      if (submissionId && /(id|submissionid|applicationid|requestid|workid|taskid)$/i.test(param.name)) {
        samples[param.name] = submissionId;
        continue;
      }

      if (param.required || param.in === 'path') {
        samples[param.name] = this.getTestValue(param);
      }
    }

    return samples;
  }

  private resolveEndpointPathWithSamples(
    path: string,
    samples: Record<string, any>,
    submissionId?: string,
  ): { path: string; unresolvedParams: string[] } {
    const unresolvedParams: string[] = [];
    const resolvedPath = path.replace(/\{(\w+)\}/g, (_, key: string) => {
      const sample = samples[key];
      if (sample !== undefined && sample !== null) {
        return encodeURIComponent(String(sample));
      }
      if (submissionId && /(id|submissionid|applicationid|requestid|workid|taskid)$/i.test(key)) {
        return encodeURIComponent(submissionId);
      }
      unresolvedParams.push(key);
      return `{${key}}`;
    });

    return { path: resolvedPath, unresolvedParams };
  }

  private buildEndpointProbeBody(
    endpoint: Endpoint,
    samples: Record<string, any>,
  ): any {
    if (endpoint.bodyTemplate) {
      return this.buildRequestBody(samples, endpoint.bodyTemplate);
    }

    const bodyEntries = (endpoint.parameters || [])
      .filter((param) => param.in === 'body' && samples[param.name] !== undefined)
      .map((param) => [param.name, samples[param.name]]);

    return bodyEntries.length > 0 ? Object.fromEntries(bodyEntries) : undefined;
  }

  private summarizeEndpointProbeFailures(
    endpointChecks: EndpointProbeResult[],
  ): { overall: ValidationOverall; failureType: ValidationFailureType; reason: string } | null {
    const failures = endpointChecks.filter(
      (check) => check.checkedWith === 'endpoint_probe' && check.status !== 'passed',
    );
    if (failures.length === 0) {
      return null;
    }

    const primary = failures[0];
    const overall = failures.some((check) =>
      ['auth_failed', 'network_unreachable', 'endpoint_not_found', 'server_error', 'unknown'].includes(
        check.failureType || 'unknown',
      ),
    )
      ? 'failed'
      : 'partial';

    const reason = failures
      .slice(0, 3)
      .map((check) => `${check.method} ${check.path}: ${check.reason || this.describeFailureType(check.failureType)}`)
      .join('；');

    return {
      overall,
      failureType: primary.failureType || 'unknown',
      reason: failures.length > 3
        ? `Endpoint probes failed (${failures.length} endpoints): ${reason}；...`
        : `Endpoint probes failed: ${reason}`,
    };
  }

  private mapHttpStatusToFailureType(statusCode?: number): ValidationFailureType {
    if (statusCode === 400) return 'param_error';
    if (statusCode === 401 || statusCode === 403) return 'auth_failed';
    if (statusCode === 404) return 'endpoint_not_found';
    if (statusCode && statusCode >= 500) return 'server_error';
    return 'unknown';
  }

  private describeHttpFailure(statusCode?: number): string {
    if (!statusCode) {
      return 'Request failed';
    }
    if (statusCode === 400) return 'Endpoint rejected the probe parameters';
    if (statusCode === 401 || statusCode === 403) return 'Authentication or permission validation failed';
    if (statusCode === 404) return 'Endpoint not found';
    if (statusCode >= 500) return `Server error: HTTP ${statusCode}`;
    return `Unexpected status code: HTTP ${statusCode}`;
  }

  private describeFailureType(failureType?: ValidationFailureType): string {
    switch (failureType) {
      case 'auth_failed':
        return 'Authentication failed';
      case 'network_unreachable':
        return 'Network unreachable';
      case 'endpoint_not_found':
        return 'Endpoint not found';
      case 'param_error':
        return 'Parameter validation failed';
      case 'mapping_error':
        return 'Response mapping failed';
      case 'purpose_mismatch':
        return 'Purpose mismatch';
      case 'server_error':
        return 'Server error';
      case 'missing_submit':
        return 'Missing submit context';
      case 'no_base_url':
        return 'No base URL';
      default:
        return 'Unknown failure';
    }
  }

  /**
   * Level 1: 参数结构验证（发送空 body）
   */
  private async validateParamStructure(
    baseUrl: string,
    endpoint: Endpoint,
    process: BusinessProcess,
    authConfig: any,
    cookieSession?: string,
  ): Promise<{
    confidence: number;
    discoveredFields: string[];
    expectedFields: string[];
      missingFields: string[];
      extraFields: string[];
  }> {
    const expectedFields = endpoint.parameters
      .filter((p) => p.in === 'body')
      .map((p) => p.name);

    if (endpoint.bodyTemplate && expectedFields.length > 0) {
      return {
        confidence: 0.95,
        discoveredFields: expectedFields,
        expectedFields,
        missingFields: [],
        extraFields: [],
      };
    }

    const url = buildFullUrl(baseUrl, endpoint.path);
    const headers = this.buildAuthHeaders(authConfig, cookieSession);

    try {
      // 发送空 body
      const response = await axios.post(url, {}, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      });

      // 分析 400 错误信息
      if (response.status === 400) {
        const errorMsg = response.data?.message || JSON.stringify(response.data);
        const discoveredFields = this.extractFieldsFromError(errorMsg);

        const matchedFields = discoveredFields.filter((f) => expectedFields.includes(f));
        const confidence = matchedFields.length / Math.max(expectedFields.length, 1);

        return {
          confidence,
          discoveredFields,
          expectedFields,
          missingFields: expectedFields.filter((f) => !discoveredFields.includes(f)),
          extraFields: discoveredFields.filter((f) => !expectedFields.includes(f)),
        };
      }

      // 如果返回 200，说明接口不校验参数（可能是宽松设计，不直接判定失败）
      if (response.status === 200) {
        this.logger.warn(`${endpoint.path} accepts empty body, might be a lenient endpoint`);
        return {
          confidence: 0.6,
          discoveredFields: [],
          expectedFields,
          missingFields: expectedFields,
          extraFields: [],
        };
      }

      // 其他状态码
      return {
        confidence: 0,
        discoveredFields: [],
        expectedFields,
        missingFields: expectedFields,
        extraFields: [],
      };
    } catch (error: any) {
      this.logger.error(`Param structure validation failed: ${error.message}`);
      return {
        confidence: 0,
        discoveredFields: [],
        expectedFields,
        missingFields: expectedFields,
        extraFields: [],
      };
    }
  }

  /**
   * 从错误信息中提取字段名
   */
  private extractFieldsFromError(errorMsg: string): string[] {
    const fields = new Set<string>();

    // 匹配常见错误格式
    const patterns = [
      /['"]?(\w+)['"]?\s*(?:is\s+)?required/gi,
      /缺少.*?[:：]\s*([a-z_,\s]+)/gi,
      /字段\s*['"]?(\w+)['"]?/gi,
      /Field\s+['"]?(\w+)['"]?/gi,
      /参数\s*['"]?(\w+)['"]?/gi,
      /Missing\s+(?:field|parameter)\s*[:：]?\s*['"]?(\w+)['"]?/gi,
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(errorMsg)) !== null) {
        const fieldStr = match[1];
        fieldStr.split(/[,，\s]+/).forEach((f) => {
          const cleaned = f.trim().toLowerCase();
          if (cleaned && /^[a-z_]+$/.test(cleaned)) {
            fields.add(cleaned);
          }
        });
      }
    });

    return Array.from(fields);
  }

  /**
   * Level 2: 真实提交验证
   */
  private async validateRealSubmit(
    baseUrl: string,
    endpoint: Endpoint,
    process: BusinessProcess,
    authConfig: any,
    cookieSession?: string,
  ): Promise<{
    success: boolean;
    submissionId?: string;
    statusCode?: number;
    responseStructureValid: boolean;
    purposeMatch: boolean;
    failureReason?: 'param_error' | 'auth_failed' | 'not_found' | 'server_error' | 'network_error';
    error?: string;
  }> {
    const url = buildFullUrl(baseUrl, endpoint.path);
    const headers = this.buildAuthHeaders(authConfig, cookieSession);

    // 构造测试数据
    const testData = this.buildTestData(endpoint.parameters);
    const requestBody = endpoint.bodyTemplate
      ? this.buildRequestBody(testData, endpoint.bodyTemplate)
      : testData;

    try {
      const response = await axios.post(url, requestBody, {
        headers,
        timeout: 15000,
        validateStatus: () => true,
      });

      // 验证响应结构
      const responseStructureValid = this.verifyResponseStructure(
        response.data,
        endpoint.responseMapping,
      );

      // 验证接口作用
      const purposeMatch = this.verifyPurpose(response.data, process.processName);

      // 提取 submissionId
      const submissionId = this.extractSubmissionId(response.data);

      // 根据状态码细化失败原因
      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          submissionId,
          statusCode: response.status,
          responseStructureValid,
          purposeMatch,
        };
      }

      // 400: 参数错误 — 接口存在但测试数据不符合要求，标记为 partial
      if (response.status === 400) {
        return {
          success: false,
          statusCode: response.status,
          responseStructureValid: false,
          purposeMatch,
          failureReason: 'param_error',
          error: response.data?.message || 'Parameter validation failed',
        };
      }

      // 401/403: 认证失败
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          statusCode: response.status,
          responseStructureValid: false,
          purposeMatch: false,
          failureReason: 'auth_failed',
          error: 'Authentication failed',
        };
      }

      // 404: 接口不存在
      if (response.status === 404) {
        return {
          success: false,
          statusCode: response.status,
          responseStructureValid: false,
          purposeMatch: false,
          failureReason: 'not_found',
          error: 'Endpoint not found',
        };
      }

      // 5xx: 服务器错误
      return {
        success: false,
        statusCode: response.status,
        responseStructureValid: false,
        purposeMatch: false,
        failureReason: 'server_error',
        error: `Server error: HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        success: false,
        statusCode: error.response?.status,
        responseStructureValid: false,
        purposeMatch: false,
        failureReason: 'network_error',
        error: error.message,
      };
    }
  }

  /**
   * 构造测试数据
   */
  private buildTestData(parameters: any[]): Record<string, any> {
    const data: Record<string, any> = {};

    for (const param of parameters) {
      if (param.in !== 'body') continue; // 只填 body 参数
      if (!param.required) continue; // 只填必填字段

      data[param.name] = this.getTestValue(param);
    }

    return data;
  }

  private getTestValue(param: any): any {
    if (param.defaultValue !== undefined) {
      return param.defaultValue;
    }

    const type = param.type || 'string';
    switch (type.toLowerCase()) {
      case 'string': {
        const maxLen = param.maxLength || param.max_length;
        const label = param.description || param.name;
        const value = `[TEST]${label}`;
        return maxLen && value.length > maxLen ? value.substring(0, maxLen) : value;
      }
      case 'number':
      case 'integer':
        return param.min ?? param.minimum ?? 1;
      case 'date': {
        // 默认用明天，兼容"未来日期"约束
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
      }
      case 'datetime': {
        const tomorrowDt = new Date();
        tomorrowDt.setDate(tomorrowDt.getDate() + 1);
        return tomorrowDt.toISOString();
      }
      case 'boolean':
        return true;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return 'test';
    }
  }

  /**
   * 验证响应结构
   */
  private verifyResponseStructure(
    response: any,
    responseMapping?: Record<string, string>,
  ): boolean {
    if (!responseMapping || Object.keys(responseMapping).length === 0) {
      return true; // 没有定义 mapping，跳过验证
    }

    const mappedEntries = Object.entries(responseMapping)
      .filter(([, path]) => typeof path === 'string' && path.length > 0);
    if (mappedEntries.length === 0) {
      return true;
    }

    const existingKeys = mappedEntries
      .filter(([, path]) => getNestedValue(response, path) !== undefined)
      .map(([field]) => field);

    if (existingKeys.length === 0) {
      return false;
    }

    const dataBearingKeys = ['data', 'id', 'submissionId'];
    const declaredDataKeys = mappedEntries
      .map(([field]) => field)
      .filter((field) => dataBearingKeys.includes(field));
    if (declaredDataKeys.length > 0) {
      return declaredDataKeys.some((field) => existingKeys.includes(field));
    }

    return true;
  }

  /**
   * 验证接口作用
   */
  private verifyPurpose(response: any, processName: string): boolean {
    const responseText = JSON.stringify(response).toLowerCase();

    // 提取流程名称中的关键词
    const keywords = this.extractKeywords(processName);

    // 至少匹配一个关键词
    return keywords.some((kw) => responseText.includes(kw.toLowerCase()));
  }

  private extractKeywords(processName: string): string[] {
    // "请假申请" → ["请假", "leave"]
    const keywordMap: Record<string, string[]> = {
      '请假': ['请假', 'leave', 'vacation'],
      '报销': ['报销', 'expense', 'reimbursement'],
      '采购': ['采购', 'purchase', 'procurement'],
      '出差': ['出差', 'travel', 'trip'],
      '用印': ['用印', 'seal', 'stamp'],
      '会议': ['会议', 'meeting', 'conference'],
      '加班': ['加班', 'overtime'],
      '调休': ['调休', 'compensatory'],
    };

    const keywords: string[] = [];
    for (const [key, values] of Object.entries(keywordMap)) {
      if (processName.includes(key)) {
        keywords.push(...values);
      }
    }

    // 如果没有匹配到预定义关键词，使用流程名称本身
    if (keywords.length === 0) {
      keywords.push(processName);
    }

    return keywords;
  }

  private extractSubmissionId(response: any): string | undefined {
    // 尝试多种可能的字段名
    const candidates = [
      response.submissionId,
      response.id,
      response.application?.id,
      response.data?.submissionId,
      response.data?.id,
      response.data?.application?.id,
      response.result?.submissionId,
      response.result?.id,
    ];

    return candidates.find((v) => typeof v === 'string' && v.length > 0);
  }

  /**
   * Level 3: 查询验证
   */
  private async validateQuery(
    baseUrl: string,
    endpoint: Endpoint,
    submissionId: string,
    authConfig: any,
    cookieSession?: string,
  ): Promise<{
    success: boolean;
    statusFound: boolean;
    statusCode?: number;
    failureType?: ValidationFailureType;
    reason?: string;
  }> {
    const path = this.resolveSubmissionPath(endpoint.path, submissionId);
    const url = buildFullUrl(baseUrl, path);
    const headers = this.buildAuthHeaders(authConfig, cookieSession);

    try {
      const response = await axios.get(url, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      });

      const statusFound = this.findStatusField(response.data);

      return {
        success: response.status >= 200 && response.status < 300,
        statusFound,
        statusCode: response.status,
        failureType: response.status >= 200 && response.status < 300
          ? undefined
          : this.mapHttpStatusToFailureType(response.status),
        reason: response.status >= 200 && response.status < 300
          ? undefined
          : this.describeHttpFailure(response.status),
      };
    } catch (error: any) {
      return {
        success: false,
        statusFound: false,
        statusCode: error.response?.status,
        failureType: 'network_unreachable',
        reason: error.message,
      };
    }
  }

  /**
   * Level 3: 撤回验证
   */
  private async validateCancel(
    baseUrl: string,
    endpoint: Endpoint,
    submissionId: string,
    authConfig: any,
    cookieSession?: string,
  ): Promise<{
    success: boolean;
    statusCode?: number;
    failureType?: ValidationFailureType;
    reason?: string;
  }> {
    const path = this.resolveSubmissionPath(endpoint.path, submissionId);
    const url = buildFullUrl(baseUrl, path);
    const headers = this.buildAuthHeaders(authConfig, cookieSession);

    try {
      const response = await axios({
        method: endpoint.method.toLowerCase(),
        url,
        headers,
        timeout: 10000,
        validateStatus: () => true,
      });

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        failureType: response.status >= 200 && response.status < 300
          ? undefined
          : this.mapHttpStatusToFailureType(response.status),
        reason: response.status >= 200 && response.status < 300
          ? undefined
          : this.describeHttpFailure(response.status),
      };
    } catch (error: any) {
      return {
        success: false,
        statusCode: error.response?.status,
        failureType: 'network_unreachable',
        reason: error.message,
      };
    }
  }

  private resolveSubmissionPath(path: string, submissionId: string): string {
    return path
      .replace(/\{id\}/g, submissionId)
      .replace(/\{submissionId\}/g, submissionId)
      .replace(/\{applicationId\}/g, submissionId)
      .replace(/\{requestId\}/g, submissionId)
      .replace(/\{workId\}/g, submissionId);
  }

  private findFormsEndpointPath(documentContent: string): string | null {
    try {
      const doc = JSON.parse(documentContent.split('\n===')[0]);
      const candidates = Object.entries(doc.paths || {})
        .flatMap(([path, pathItem]) =>
          Object.entries(pathItem as Record<string, any>).map(([method, operation]) => ({
            path,
            method: method.toUpperCase(),
            operation,
          })),
        )
        .filter(({ method }) => method === 'GET')
        .map(({ path, operation }) => {
          const op = operation as Record<string, any>;
          const tags = Array.isArray(op.tags) ? op.tags.join(' ') : '';
          const summary = [op.summary, op.description, tags].filter(Boolean).join(' ').toLowerCase();
          const responseSchema =
            op.responses?.['200']?.content?.['application/json']?.schema ||
            op.responses?.default?.content?.['application/json']?.schema;
          const responseProperties = Object.keys(responseSchema?.properties || {}).map((key) => key.toLowerCase());
          const score =
            (summary.includes('form') || summary.includes('流程模板') || summary.includes('模板列表') ? 3 : 0) +
            (responseProperties.includes('forms') ? 4 : 0) +
            (path.toLowerCase().includes('form') ? 2 : 0);
          return { path, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.path || null;
    } catch {
      return null;
    }
  }

  private findStatusField(value: any): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const queue: any[] = [value];
    const visited = new Set<any>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (
        typeof current.status === 'string' ||
        typeof current.currentStatus === 'string' ||
        typeof current.workflowStatus === 'string'
      ) {
        return true;
      }

      for (const nested of Object.values(current)) {
        if (nested && typeof nested === 'object') {
          queue.push(nested);
        }
      }
    }

    return false;
  }

  private buildRequestBody(params: Record<string, any>, template: any): any {
    if (!template) {
      return params;
    }

    if (typeof template === 'string') {
      const match = template.match(/^\{\{(\w+)\}\}$/);
      if (match) {
        return params[match[1]];
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '');
    }

    if (Array.isArray(template)) {
      return template
        .map((item) => this.buildRequestBody(params, item))
        .filter((item) => item !== undefined);
    }

    if (typeof template === 'object' && template !== null) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(template)) {
        const resolved = this.buildRequestBody(params, value);
        if (resolved !== undefined) {
          result[key] = resolved;
        }
      }
      return result;
    }

    return template;
  }

  /**
   * 构建认证请求头（简化版，不再重复登录）
   */
  private buildAuthHeaders(authConfig: any, cookieSession?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    switch (authConfig.authType) {
      case 'apikey':
        headers[authConfig.headerName || 'x-token'] = authConfig.token;
        break;
      case 'basic':
        headers['Authorization'] = `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')}`;
        break;
      case 'oauth2':
      case 'bearer':
        headers['Authorization'] = `Bearer ${authConfig.accessToken || authConfig.token}`;
        break;
      case 'cookie':
        if (cookieSession) {
          headers['Cookie'] = cookieSession;
        }
        break;
    }

    return headers;
  }

  /**
   * Cookie auth 预登录（带缓存）
   */
  private async loginForCookie(baseUrl: string, authConfig: any): Promise<string | undefined> {
    // 检查缓存
    const cacheKey = `${baseUrl}:${authConfig.username}`;
    const cached = this.cookieSessionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.cookie;
    }

    const loginPath = authConfig.loginPath || '/api/auth/login';

    try {
      const response = await axios.post(
        buildFullUrl(baseUrl, loginPath),
        {
          username: authConfig.username,
          password: authConfig.password,
        },
        { timeout: 10000, validateStatus: () => true },
      );

      const setCookies = response.headers['set-cookie'];
      if (setCookies && setCookies.length > 0) {
        const cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');
        // 缓存 1 小时
        this.cookieSessionCache.set(cacheKey, {
          cookie,
          expiresAt: Date.now() + 3600_000,
        });
        return cookie;
      }
    } catch (error: any) {
      this.logger.warn(`Cookie auth login failed: ${error.message}`);
    }

    return undefined;
  }

  // ============================================================
  // NORMALIZING 阶段
  // ============================================================

  private async runNormalization(
    jobId: string,
    processes: BusinessProcess[],
    validationResults: ProcessValidationResult[],
    reportId: string,
  ) {
    this.logger.log(`Normalizing ${processes.length} business processes`);

    await this.prisma.fieldIR.deleteMany({ where: { bootstrapJobId: jobId } });
    await this.prisma.flowIR.deleteMany({ where: { bootstrapJobId: jobId } });
    const repairSummaries = await this.getFlowRepairSummaries(jobId);

    for (const proc of processes) {
      const validation = validationResults.find((result) => result.processCode === proc.processCode);
      const repair = repairSummaries[proc.processCode];
      await this.prisma.flowIR.upsert({
        where: {
          bootstrapJobId_flowCode: {
            bootstrapJobId: jobId,
            flowCode: proc.processCode,
          },
        },
        create: {
          bootstrapJobId: jobId,
          flowCode: proc.processCode,
          flowName: proc.processName,
          flowCategory: proc.category,
          entryUrl: proc.endpoints[0]?.path,
          submitUrl: proc.endpoints.find((e) => e.category === 'submit')?.path
            || proc.endpoints.find((e) => e.method === 'POST')?.path,
          queryUrl: proc.endpoints.find((e) => e.category === 'query' || e.category === 'status_query')?.path
            || proc.endpoints.find((e) => e.method === 'GET')?.path,
          metadata: {
            description: proc.description,
            endpointCount: proc.endpoints.length,
            validation: this.toFlowValidationMetadata(validation),
            repair: repair || null,
          } as any,
        },
        update: {
          flowName: proc.processName,
          flowCategory: proc.category,
          submitUrl: proc.endpoints.find((e) => e.category === 'submit')?.path
            || proc.endpoints.find((e) => e.method === 'POST')?.path,
          queryUrl: proc.endpoints.find((e) => e.category === 'query' || e.category === 'status_query')?.path
            || proc.endpoints.find((e) => e.method === 'GET')?.path,
          metadata: {
            description: proc.description,
            endpointCount: proc.endpoints.length,
            validation: this.toFlowValidationMetadata(validation),
            repair: repair || null,
          } as any,
        },
      });

      // 收集 body 参数作为表单字段（path/query 参数不是用户填写的）
      const uniqueParams = new Map<string, any>();
      for (const ep of proc.endpoints) {
        for (const p of ep.parameters || []) {
          if (p.in === 'body' && !uniqueParams.has(p.name)) {
            uniqueParams.set(p.name, p);
          }
        }
      }

      for (const [, param] of uniqueParams) {
        await this.prisma.fieldIR.upsert({
          where: {
            bootstrapJobId_flowCode_fieldKey: {
              bootstrapJobId: jobId,
              flowCode: proc.processCode,
              fieldKey: param.name,
            },
          },
          create: {
            bootstrapJobId: jobId,
            flowCode: proc.processCode,
            fieldKey: param.name,
            fieldLabel: param.description || param.name,
            fieldType: param.type || 'string',
            required: param.required || false,
          },
          update: {
            fieldLabel: param.description || param.name,
            fieldType: param.type || 'string',
            required: param.required || false,
          },
        });
      }
    }

    const totalEndpoints = processes.reduce((sum, p) => sum + p.endpoints.length, 0);
    const passedCount = validationResults.filter((result) => result.overall === 'passed').length;
    const partialCount = validationResults.filter((result) => result.overall === 'partial').length;
    const failedCount = validationResults.filter((result) => result.overall === 'failed').length;
    const passedProcesses = processes.filter((process) =>
      validationResults.some((result) => result.processCode === process.processCode && result.overall === 'passed'),
    );
    const passedEndpoints = passedProcesses.reduce((sum, process) => sum + process.endpoints.length, 0);

    // 动态计算 OCL 等级和置信度
    const { oclLevel, coverage, confidence, risk } = this.computeOclMetrics(passedProcesses, passedEndpoints);

    await this.appendReportEvidence(reportId, [{
      type: 'validation_gate',
      description: `Validation gate: ${passedCount} passed, ${partialCount} partial, ${failedCount} failed`,
      passed: passedCount,
      partial: partialCount,
      failed: failedCount,
      details: validationResults as any,
      repairSummary: repairSummaries as any,
    }], {
      oclLevel,
      coverage,
      confidence,
      risk,
      recommendation: passedCount > 0
        ? `Identified ${processes.length} business processes (${totalEndpoints} endpoints). ${passedCount} flows passed validation and are eligible for MCP registration.`
        : `Identified ${processes.length} business processes, but no flow passed validation. Please fix connectivity/authentication or endpoint mapping and retry.`,
    });

    this.logger.log(`Normalization complete: ${processes.length} processes, ${totalEndpoints} endpoints`);
  }

  // ============================================================
  // COMPILING 阶段（MCP Generation + Publishing）
  // ============================================================

  private async runCompiling(
    bootstrapJob: any,
    processes: BusinessProcess[],
    finalStatus: 'PUBLISHED' | 'PARTIALLY_PUBLISHED',
    failedProcessCodes: string[],
  ) {
    if (processes.length === 0) {
      this.logger.warn('No processes to compile, skipping MCP publication');
      return;
    }

    const baseUrl = this.resolveBaseUrl(bootstrapJob);
    const authConfig = bootstrapJob.authConfig || {};
    const authType = authConfig.authType;
    const connectorName = bootstrapJob.name || `OA-${bootstrapJob.id.substring(0, 8)}`;
    const oclLevel = this.computeOclLevel(processes);

    // 拆分 authConfig 为公开部分和敏感部分
    const { publicConfig, secretFields } = this.splitAuthConfig(authConfig);

    // 使用事务保证 Connector + Capability + SecretRef + MCPTool + RemoteProcess + ProcessTemplate 的一致性
    await this.prisma.$transaction(async (tx) => {
      // ── 1. 创建或更新 Connector ──
      const connector = await tx.connector.upsert({
        where: {
          tenantId_name: {
            tenantId: bootstrapJob.tenantId,
            name: connectorName,
          },
        },
        create: {
          tenantId: bootstrapJob.tenantId,
          name: connectorName,
          oaType: 'openapi',
          baseUrl,
          authType,
          authConfig: publicConfig,
          oclLevel,
          status: 'active',
        },
        update: {
          baseUrl,
          authType,
          authConfig: publicConfig,
          oclLevel,
          status: 'active',
        },
      });

      this.logger.log(`Connector upserted: ${connector.id} (${connectorName})`);

      if (failedProcessCodes.length > 0) {
        await this.disableConnectorArtifacts(tx, connector.id, failedProcessCodes);
      }

      // ── 2. 创建 ConnectorCapability（根据端点推断能力）──
      const capabilities = this.inferCapabilities(processes);
      await tx.connectorCapability.upsert({
        where: { connectorId: connector.id },
        create: {
          tenantId: bootstrapJob.tenantId,
          connectorId: connector.id,
          ...capabilities,
          syncModes: ['full'],
          metadata: {
            inferredFrom: 'bootstrap_pipeline',
            oclLevel,
          },
        },
        update: {
          ...capabilities,
          syncModes: ['full'],
          metadata: {
            inferredFrom: 'bootstrap_pipeline',
            oclLevel,
          },
        },
      });

      // ── 3. 创建 ConnectorSecretRef（如果有敏感字段）──
      if (secretFields) {
        await tx.connectorSecretRef.upsert({
          where: { connectorId: connector.id },
          create: {
            tenantId: bootstrapJob.tenantId,
            connectorId: connector.id,
            secretProvider: 'env',
            secretPath: `BOOTSTRAP_SECRET_${connector.id.replace(/-/g, '_').toUpperCase()}`,
          },
          update: {
            secretProvider: 'env',
            secretPath: `BOOTSTRAP_SECRET_${connector.id.replace(/-/g, '_').toUpperCase()}`,
          },
        });

        // 将敏感字段写入环境变量（运行时使用）
        const envKey = `BOOTSTRAP_SECRET_${connector.id.replace(/-/g, '_').toUpperCase()}`;
        process.env[envKey] = JSON.stringify(secretFields);
        this.logger.log(`Secret stored in env: ${envKey}`);
      }

      // ── 4. 创建 MCPTool ──
      let toolCount = 0;
      const usedNames = new Set<string>();

      for (const proc of processes) {
        for (const endpoint of proc.endpoints) {
          let toolName = this.generateToolName(proc.processCode, endpoint);

          if (usedNames.has(toolName)) {
            let suffix = 2;
            while (usedNames.has(`${toolName}_${suffix}`)) suffix++;
            toolName = `${toolName}_${suffix}`;
          }
          usedNames.add(toolName);

          // 构建 toolSchema（只包含 body 参数，path/query 参数由运行时处理）
          const properties: Record<string, any> = {};
          const required: string[] = [];

          for (const param of endpoint.parameters || []) {
            const property: Record<string, any> = {
              type: param.type || 'string',
              description: param.description || param.name,
            };
            if (param.defaultValue !== undefined) {
              property.default = param.defaultValue;
            }
            properties[param.name] = property;
            if (param.required) required.push(param.name);
          }

          // 构建 paramMapping（区分 path/query/body）
          const paramMapping: Record<string, any> = {};
          for (const param of endpoint.parameters || []) {
            paramMapping[param.name] = param.name;
          }

          // 使用 LLM 输出的 responseMapping，不硬编码
          const responseMapping = endpoint.responseMapping || {
            success: 'success',
            data: 'data',
            message: 'message',
          };

          try {
            await tx.mCPTool.upsert({
              where: {
                connectorId_toolName: {
                  connectorId: connector.id,
                  toolName,
                },
              },
              create: {
                tenantId: bootstrapJob.tenantId,
                connectorId: connector.id,
                toolName,
                toolDescription: `${proc.processName} - ${endpoint.description}`,
                toolSchema: { type: 'object', properties, required },
                apiEndpoint: buildFullUrl(baseUrl, endpoint.path),
                httpMethod: endpoint.method,
                headers: Prisma.JsonNull,
                bodyTemplate: endpoint.bodyTemplate ?? Prisma.JsonNull,
                paramMapping,
                responseMapping,
                flowCode: proc.processCode,
                category: endpoint.category || 'other',
                enabled: true,
                testInput: this.generateTestInput(endpoint.parameters),
                testOutput: Prisma.JsonNull,
              },
              update: {
                toolDescription: `${proc.processName} - ${endpoint.description}`,
                toolSchema: { type: 'object', properties, required },
                apiEndpoint: buildFullUrl(baseUrl, endpoint.path),
                httpMethod: endpoint.method,
                headers: Prisma.JsonNull,
                bodyTemplate: endpoint.bodyTemplate ?? Prisma.JsonNull,
                paramMapping,
                responseMapping,
                flowCode: proc.processCode,
                category: endpoint.category || 'other',
                enabled: true,
              },
            });
            toolCount++;
          } catch (error: any) {
            this.logger.warn(`Failed to upsert tool ${toolName}: ${error.message}`);
          }
        }
      }

      this.logger.log(`Generated ${toolCount} MCP tools`);

      // ── 5. 创建 RemoteProcess + ProcessTemplate（Publishing）──
      let publishedCount = 0;

      for (const proc of processes) {
        const sourceHash = createHash('sha256')
          .update(JSON.stringify({
            processCode: proc.processCode,
            processName: proc.processName,
            description: proc.description,
            endpoints: proc.endpoints.map((e) => ({ path: e.path, method: e.method })),
          }))
          .digest('hex');

        const remoteProcess = await tx.remoteProcess.upsert({
          where: {
            connectorId_remoteProcessId: {
              connectorId: connector.id,
              remoteProcessId: proc.processCode,
            },
          },
          create: {
            tenantId: bootstrapJob.tenantId,
            connectorId: connector.id,
            remoteProcessId: proc.processCode,
            remoteProcessCode: proc.processCode,
            remoteProcessName: proc.processName,
            processCategory: proc.category,
            sourceHash,
            sourceVersion: '1',
            status: 'active',
            metadata: {
              source: 'bootstrap_pipeline',
              description: proc.description,
              endpointCount: proc.endpoints.length,
            },
            lastSchemaSyncAt: new Date(),
            lastDriftCheckAt: new Date(),
          },
          update: {
            remoteProcessName: proc.processName,
            processCategory: proc.category,
            sourceHash,
            status: 'active',
            metadata: {
              source: 'bootstrap_pipeline',
              description: proc.description,
              endpointCount: proc.endpoints.length,
            },
            lastSchemaSyncAt: new Date(),
            lastDriftCheckAt: new Date(),
          },
        });

        // 收集 body 参数作为表单 schema fields
        const schemaFields = proc.endpoints
          .flatMap((ep) => ep.parameters || [])
          .filter((p) => p.in === 'body')
          .reduce((acc, p) => {
            if (!acc.find((f: any) => f.key === p.name)) {
              acc.push({
                key: p.name,
                label: p.description || p.name,
                type: this.mapFieldType(p.type),
                required: p.required || false,
              });
            }
            return acc;
          }, [] as any[]);

        // 确定 FAL level
        const hasSubmit = proc.endpoints.some((e) => e.category === 'submit');
        const hasQuery = proc.endpoints.some((e) => e.category === 'query' || e.category === 'list');
        let falLevel = 'F1';
        if (hasSubmit && hasQuery && schemaFields.length >= 3) falLevel = 'F3';
        else if (hasSubmit && schemaFields.length >= 1) falLevel = 'F2';

        const latestTemplate = await tx.processTemplate.findFirst({
          where: { connectorId: connector.id, processCode: proc.processCode },
          orderBy: { version: 'desc' },
        });
        const reusableTemplate = sourceHash
          ? await tx.processTemplate.findFirst({
            where: {
              connectorId: connector.id,
              processCode: proc.processCode,
              sourceHash,
            },
            orderBy: { version: 'desc' },
          })
          : null;

        const templatePayload = {
          tenantId: bootstrapJob.tenantId,
          connectorId: connector.id,
          remoteProcessId: remoteProcess.id,
          processCode: proc.processCode,
          processName: proc.processName,
          processCategory: proc.category,
          description: proc.description,
          status: 'published',
          falLevel,
          sourceHash,
          schema: { fields: schemaFields },
          rules: Prisma.JsonNull,
          permissions: Prisma.JsonNull,
          uiHints: {
            endpoints: proc.endpoints.map((e) => ({
              path: e.path,
              method: e.method,
              category: e.category,
            })),
          },
          lastSyncedAt: new Date(),
          publishedAt: new Date(),
        } satisfies Prisma.ProcessTemplateUncheckedCreateInput;

        const template = reusableTemplate
          ? await tx.processTemplate.update({
            where: { id: reusableTemplate.id },
            data: {
              remoteProcessId: remoteProcess.id,
              processName: proc.processName,
              processCategory: proc.category,
              description: proc.description,
              status: 'published',
              falLevel,
              sourceHash,
              sourceVersion: String(reusableTemplate.version),
              schema: { fields: schemaFields },
              rules: Prisma.JsonNull,
              permissions: Prisma.JsonNull,
              uiHints: templatePayload.uiHints,
              lastSyncedAt: new Date(),
              publishedAt: new Date(),
            },
          })
          : await tx.processTemplate.create({
            data: {
              ...templatePayload,
              version: latestTemplate ? latestTemplate.version + 1 : 1,
              sourceVersion: String(latestTemplate ? latestTemplate.version + 1 : 1),
              supersedesId: latestTemplate?.id,
            },
          });

        await tx.processTemplate.updateMany({
          where: {
            connectorId: connector.id,
            processCode: proc.processCode,
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

        publishedCount++;
      }

      this.logger.log(`Published ${publishedCount} process templates`);

      await tx.connector.update({
        where: { id: connector.id },
        data: { status: 'active' },
      });

      // ── 6. 回写 connectorId 到 BootstrapJob，状态 → PUBLISHED ──
      await tx.bootstrapJob.update({
        where: { id: bootstrapJob.id },
        data: {
          connectorId: connector.id,
          status: finalStatus,
          currentStage: finalStatus,
          stageStartedAt: new Date(),
          lastHeartbeatAt: new Date(),
          stalledReason: null,
          lastError: null,
          completedAt: new Date(),
        },
      });

      // ── 7. 记录 AdapterBuild ──
      await tx.adapterBuild.create({
        data: {
          bootstrapJobId: bootstrapJob.id,
          adapterType: 'mcp',
          generatedCode: `// MCP-based adapter: ${toolCount} tools, ${publishedCount} templates`,
          buildStatus: 'success',
        },
      });
    });
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private async disableArtifactsForFailedProcesses(
    bootstrapJob: any,
    failedProcessCodes: string[],
  ): Promise<void> {
    if (failedProcessCodes.length === 0) {
      return;
    }

    const connectorName = bootstrapJob.name || `OA-${bootstrapJob.id.substring(0, 8)}`;
    const connector = await this.prisma.connector.findUnique({
      where: {
        tenantId_name: {
          tenantId: bootstrapJob.tenantId,
          name: connectorName,
        },
      },
      select: { id: true },
    });

    if (!connector) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.disableConnectorArtifacts(tx, connector.id, failedProcessCodes);
    });
  }

  private async disableConnectorArtifacts(
    tx: Prisma.TransactionClient,
    connectorId: string,
    processCodes: string[],
  ): Promise<void> {
    if (processCodes.length === 0) {
      return;
    }

    await tx.mCPTool.updateMany({
      where: {
        connectorId,
        flowCode: { in: processCodes },
      },
      data: { enabled: false },
    });

    await tx.processTemplate.updateMany({
      where: {
        connectorId,
        processCode: { in: processCodes },
        status: 'published',
      },
      data: {
        status: 'archived',
      },
    });

    await tx.remoteProcess.updateMany({
      where: {
        connectorId,
        remoteProcessId: { in: processCodes },
      },
      data: { status: 'disabled' },
    });

    const remainingEnabledTools = await tx.mCPTool.count({
      where: {
        connectorId,
        enabled: true,
      },
    });

    await tx.connector.update({
      where: { id: connectorId },
      data: {
        status: remainingEnabledTools > 0 ? 'active' : 'inactive',
      },
    });
  }

  private async appendReportEvidence(
    reportId: string,
    evidenceItems: Record<string, any>[],
    updates?: {
      oclLevel?: string;
      coverage?: number;
      confidence?: number;
      risk?: string;
      recommendation?: string;
    },
  ) {
    const report = await this.prisma.bootstrapReport.findUnique({
      where: { id: reportId },
      select: { evidence: true },
    });
    const existingEvidence = Array.isArray(report?.evidence) ? report.evidence : [];

    await this.prisma.bootstrapReport.update({
      where: { id: reportId },
      data: {
        ...(updates || {}),
        evidence: [...existingEvidence, ...evidenceItems] as any,
      },
    });
  }

  private async getFlowRepairSummaries(jobId: string): Promise<Record<string, FlowRepairSummary>> {
    const attempts = await this.prisma.bootstrapRepairAttempt.findMany({
      where: { bootstrapJobId: jobId },
      orderBy: [
        { flowCode: 'asc' },
        { attemptNo: 'asc' },
      ],
    });

    const summaries: Record<string, FlowRepairSummary> = {};
    for (const attempt of attempts) {
      const summary = summaries[attempt.flowCode] || {
        automated: true,
        attempts: 0,
        lastStatus: 'not_attempted',
        lastFailureType: null,
        lastSummary: null,
        lastConfidence: null,
        lastAttemptAt: null,
      };
      const proposedPatch = (attempt.proposedPatch as Record<string, any> | null) || {};
      summaries[attempt.flowCode] = {
        automated: true,
        attempts: summary.attempts + 1,
        lastStatus: attempt.status as FlowRepairSummary['lastStatus'],
        lastFailureType: (attempt.triggerReason as ValidationFailureType) || null,
        lastSummary: (proposedPatch.summary as string | undefined) || attempt.errorMessage || summary.lastSummary,
        lastConfidence: attempt.confidence ?? null,
        lastAttemptAt: attempt.createdAt.toISOString(),
      };
    }

    return summaries;
  }

  private sanitizeRepairedProcess(
    original: BusinessProcess,
    candidate: BusinessProcess,
    apiDoc: string | null,
  ): { accepted: boolean; process?: BusinessProcess; changedFields: string[]; reason?: string } {
    if (!candidate.endpoints || candidate.endpoints.length === 0) {
      return { accepted: false, changedFields: [], reason: 'Repaired process has no endpoints' };
    }

    const documentedPaths = this.extractDocumentPaths(apiDoc);
    const normalizedProcess: BusinessProcess = {
      processName: candidate.processName || original.processName,
      processCode: original.processCode,
      category: candidate.category || original.category,
      description: candidate.description || original.description,
      endpoints: candidate.endpoints.map((endpoint) => ({
        ...endpoint,
        method: endpoint.method.toUpperCase(),
      })),
    };

    if (!normalizedProcess.endpoints.some((endpoint) => endpoint.category === 'submit')) {
      return { accepted: false, changedFields: [], reason: 'Repaired process is missing submit endpoint' };
    }

    if (documentedPaths.size > 0) {
      const hasUnknownPath = normalizedProcess.endpoints.some((endpoint) => !documentedPaths.has(endpoint.path));
      if (hasUnknownPath) {
        return { accepted: false, changedFields: [], reason: 'Repaired process introduced undocumented endpoint path' };
      }
    }

    return {
      accepted: true,
      process: normalizedProcess,
      changedFields: this.buildProcessDiff(original, normalizedProcess),
    };
  }

  private extractDocumentPaths(apiDoc: string | null): Set<string> {
    if (!apiDoc) {
      return new Set<string>();
    }

    try {
      const raw = apiDoc.split('\n===')[0];
      const doc = JSON.parse(raw);
      return new Set<string>(Object.keys(doc.paths || {}));
    } catch {
      return new Set<string>();
    }
  }

  private buildProcessDiff(original: BusinessProcess, candidate: BusinessProcess): string[] {
    const changes = new Set<string>();
    if (original.processName !== candidate.processName) changes.add('processName');
    if (original.category !== candidate.category) changes.add('category');
    if (original.description !== candidate.description) changes.add('description');
    if (original.endpoints.length !== candidate.endpoints.length) changes.add('endpoints.length');

    const maxLen = Math.max(original.endpoints.length, candidate.endpoints.length);
    for (let index = 0; index < maxLen; index++) {
      const prev = original.endpoints[index];
      const next = candidate.endpoints[index];
      if (!prev || !next) continue;
      if (prev.path !== next.path) changes.add(`endpoints[${index}].path`);
      if (prev.method !== next.method) changes.add(`endpoints[${index}].method`);
      if (prev.category !== next.category) changes.add(`endpoints[${index}].category`);
      if (JSON.stringify(prev.parameters || []) !== JSON.stringify(next.parameters || [])) {
        changes.add(`endpoints[${index}].parameters`);
      }
      if (JSON.stringify(prev.responseMapping || {}) !== JSON.stringify(next.responseMapping || {})) {
        changes.add(`endpoints[${index}].responseMapping`);
      }
      if (JSON.stringify(prev.bodyTemplate ?? null) !== JSON.stringify(next.bodyTemplate ?? null)) {
        changes.add(`endpoints[${index}].bodyTemplate`);
      }
    }

    return Array.from(changes);
  }

  private cloneProcess(process: BusinessProcess): BusinessProcess {
    return JSON.parse(JSON.stringify(process)) as BusinessProcess;
  }

  private toFlowValidationMetadata(validation?: ProcessValidationResult) {
    if (!validation) {
      return {
        status: 'failed',
        retryable: true,
        reason: 'Validation result missing',
      };
    }

    const endpointChecks = validation.endpointChecks || [];
    const failedEndpointChecks = endpointChecks.filter((check) => check.status !== 'passed');

    return {
      status: validation.overall,
      retryable: validation.overall !== 'passed',
      failureType: validation.failureType || null,
      repairable: validation.repairable ?? false,
      reason: validation.reason || validation.submit?.failureReason || null,
      statusCode: validation.submit?.statusCode || null,
      paramConfidence: validation.paramStructure?.confidence ?? null,
      responseStructureValid: validation.submit?.responseStructureValid ?? null,
      purposeMatch: validation.submit?.purposeMatch ?? null,
      querySuccess: validation.query?.success ?? null,
      queryStatusFound: validation.query?.statusFound ?? null,
      cancelSuccess: validation.cancel?.success ?? null,
      endpointCheckedCount: endpointChecks.length,
      endpointPassedCount: endpointChecks.filter((check) => check.status === 'passed').length,
      endpointFailedCount: failedEndpointChecks.length,
      failedEndpoints: failedEndpointChecks.slice(0, 5).map((check) => ({
        name: check.endpointName,
        method: check.method,
        path: check.path,
        category: check.category,
        failureType: check.failureType || null,
        reason: check.reason || null,
        statusCode: check.statusCode ?? null,
      })),
      error: validation.submit?.error || null,
    };
  }

  /**
   * 拆分 authConfig 为公开部分和敏感部分
   */
  private splitAuthConfig(authConfig: any): {
    publicConfig: Record<string, any>;
    secretFields: Record<string, any> | null;
  } {
    if (!authConfig) return { publicConfig: {}, secretFields: null };

    const sensitiveKeys = new Set(['password', 'token', 'appSecret', 'accessToken', 'refreshToken', 'secret']);
    const publicConfig: Record<string, any> = {};
    const secretFields: Record<string, any> = {};
    let hasSecret = false;

    for (const [key, value] of Object.entries(authConfig)) {
      if (sensitiveKeys.has(key)) {
        secretFields[key] = value;
        hasSecret = true;
      } else {
        publicConfig[key] = value;
      }
    }

    return {
      publicConfig,
      secretFields: hasSecret ? secretFields : null,
    };
  }

  private generateToolName(processCode: string, ep: Endpoint): string {
    const method = ep.method.toLowerCase();

    const pathParts = ep.path
      .split('/')
      .filter((p: string) => p && !p.startsWith('{'));
    const resource = pathParts.slice(-2).join('_') || 'resource';
    return `${processCode}_${method}_${resource}`
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase()
      .substring(0, 120);
  }

  private generateTestInput(params: any[] | undefined): Record<string, any> {
    const input: Record<string, any> = {};
    for (const param of params || []) {
      if (param.required) {
        if (param.defaultValue !== undefined) {
          input[param.name] = param.defaultValue;
        } else {
          input[param.name] = param.type === 'number' ? 1 : 'test';
        }
      }
    }
    return input;
  }

  private mapFieldType(apiType: string): string {
    const typeMap: Record<string, string> = {
      string: 'text',
      number: 'number',
      integer: 'number',
      boolean: 'checkbox',
      array: 'select',
      object: 'json',
      file: 'file',
    };
    return typeMap[apiType] || 'text';
  }

  /**
   * 根据实际发现的端点类型推断 ConnectorCapability
   */
  private inferCapabilities(processes: BusinessProcess[]): {
    supportsDiscovery: boolean;
    supportsSchemaSync: boolean;
    supportsReferenceSync: boolean;
    supportsStatusPull: boolean;
    supportsCancel: boolean;
    supportsUrge: boolean;
  } {
    const allCategories = new Set<string>();
    for (const proc of processes) {
      for (const ep of proc.endpoints) {
        allCategories.add(ep.category);
      }
    }

    return {
      supportsDiscovery: processes.length > 0,
      supportsSchemaSync: allCategories.has('submit') || allCategories.has('query'),
      supportsReferenceSync: allCategories.has('reference_data'),
      supportsStatusPull: allCategories.has('status_query') || allCategories.has('query') || allCategories.has('list'),
      supportsCancel: allCategories.has('cancel'),
      supportsUrge: allCategories.has('urge'),
    };
  }

  /**
   * 从 bootstrapJob 中解析 baseUrl
   * 优先级：oaUrl > openApiUrl 的 origin > API 文档 servers 字段 > fallback
   */
  private resolveBaseUrl(bootstrapJob: any): string {
    // 1. 优先使用 oaUrl
    if (bootstrapJob.oaUrl) {
      return new URL(bootstrapJob.oaUrl).origin;
    }

    // 2. 尝试从 openApiUrl 推断 origin
    if (bootstrapJob.openApiUrl) {
      try {
        return new URL(bootstrapJob.openApiUrl).origin;
      } catch { /* ignore */ }
    }

    // 3. 尝试从 API 文档的 servers 字段提取
    const docSource = (bootstrapJob.sources || []).find(
      (s: any) => s.sourceContent && ['openapi', 'swagger'].includes(s.sourceType),
    );
    if (docSource?.sourceContent) {
      try {
        const doc = JSON.parse(docSource.sourceContent);
        const serverUrl = doc.servers?.[0]?.url;
        if (serverUrl) return serverUrl.replace(/\/+$/, '');
      } catch { /* ignore */ }
    }

    return 'http://localhost';
  }

  /**
   * 根据端点覆盖度动态计算 OCL 等级
   * OCL1: 仅有查询能力
   * OCL2: 有提交+查询能力
   * OCL3: 有提交+查询+审批/撤回等完整流程能力
   */
  private computeOclLevel(processes: BusinessProcess[]): string {
    const allCategories = new Set<string>();
    for (const proc of processes) {
      for (const ep of proc.endpoints) {
        allCategories.add(ep.category);
      }
    }

    const hasSubmit = allCategories.has('submit');
    const hasQuery = allCategories.has('query') || allCategories.has('list') || allCategories.has('status_query');
    const hasLifecycle = allCategories.has('approve') || allCategories.has('cancel') || allCategories.has('urge');

    if (hasSubmit && hasQuery && hasLifecycle) return 'OCL3';
    if (hasSubmit && hasQuery) return 'OCL2';
    if (hasQuery) return 'OCL1';
    return 'OCL0';
  }

  /**
   * 根据验证结果动态计算 OCL 指标（用于 BootstrapReport）
   */
  private computeOclMetrics(processes: BusinessProcess[], totalEndpoints: number): {
    oclLevel: string;
    coverage: number;
    confidence: number;
    risk: string;
  } {
    const oclLevel = this.computeOclLevel(processes);

    // coverage: 基于端点类型覆盖度
    const allCategories = new Set<string>();
    for (const proc of processes) {
      for (const ep of proc.endpoints) {
        allCategories.add(ep.category);
      }
    }
    const coreCategories = ['submit', 'query', 'list', 'approve', 'cancel', 'status_query'];
    const coveredCore = coreCategories.filter((c) => allCategories.has(c)).length;
    const coverage = Math.round((coveredCore / coreCategories.length) * 100) / 100;

    // confidence: 基于流程数和端点数
    let confidence = 0.5;
    if (processes.length >= 1 && totalEndpoints >= 3) confidence = 0.7;
    if (processes.length >= 2 && totalEndpoints >= 6) confidence = 0.8;
    if (processes.length >= 3 && totalEndpoints >= 10) confidence = 0.9;
    if (coveredCore >= 4) confidence = Math.min(confidence + 0.05, 0.95);

    // risk: 基于 OCL 等级
    let risk = 'high';
    if (oclLevel === 'OCL2') risk = 'medium';
    if (oclLevel === 'OCL3') risk = 'low';

    return { oclLevel, coverage, confidence, risk };
  }

  private shouldSkipQueuedExecution(
    bootstrapJob: { status: string; queueJobId?: string | null },
    queueJobId?: string,
  ): { skip: boolean; reason?: string } {
    if (BOOTSTRAP_TERMINAL_STATUSES.includes(bootstrapJob.status as any)) {
      return {
        skip: true,
        reason: `job already reached terminal status ${bootstrapJob.status}`,
      };
    }

    if (queueJobId && bootstrapJob.queueJobId && queueJobId !== bootstrapJob.queueJobId) {
      return {
        skip: true,
        reason: `queue token ${queueJobId} is stale; current token is ${bootstrapJob.queueJobId}`,
      };
    }

    if (!queueJobId && bootstrapJob.queueJobId) {
      return {
        skip: true,
        reason: 'missing queue token for runtime-managed bootstrap job',
      };
    }

    return { skip: false };
  }

  private startJobHeartbeat(jobId: string): () => void {
    const timer = setInterval(() => {
      void this.touchJobHeartbeat(jobId);
    }, BOOTSTRAP_JOB_HEARTBEAT_INTERVAL_MS);
    timer.unref();

    return () => {
      clearInterval(timer);
    };
  }

  private async touchJobHeartbeat(
    jobId: string,
    extraData: Prisma.BootstrapJobUpdateInput = {},
  ) {
    try {
      await this.prisma.bootstrapJob.update({
        where: { id: jobId },
        data: {
          lastHeartbeatAt: new Date(),
          ...extraData,
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to update heartbeat for ${jobId}: ${error.message}`);
    }
  }

  private async transitionState(
    jobId: string,
    newState: string,
    extraData: Prisma.BootstrapJobUpdateInput = {},
  ) {
    this.logger.debug(`${jobId} -> ${newState}`);
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        status: newState,
        currentStage: newState,
        stageStartedAt: new Date(),
        lastHeartbeatAt: new Date(),
        ...(newState === 'FAILED' || newState === 'VALIDATION_FAILED'
          ? {}
          : {
            stalledReason: null,
          }),
        ...extraData,
      },
    });
  }
}
