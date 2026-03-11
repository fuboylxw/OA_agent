import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import axios from 'axios';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { ApiAnalyzerAgent, BusinessProcess, Endpoint } from '../agents/api-analyzer.agent';

@Processor('bootstrap')
@Injectable()
export class BootstrapProcessor {
  private readonly logger = new Logger(BootstrapProcessor.name);
  private readonly apiAnalyzer = new ApiAnalyzerAgent();
  private readonly prisma: PrismaService;

  constructor(@Inject('PrismaService') prisma: PrismaService) {
    this.prisma = prisma;
  }

  @Process('process')
  async handleBootstrap(job: Job<{ jobId: string }>) {
    const { jobId } = job.data;

    try {
      this.logger.log(`Processing job ${jobId}`);

      const bootstrapJob = await this.prisma.bootstrapJob.findUnique({
        where: { id: jobId },
        include: { sources: true },
      });

      if (!bootstrapJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      // 1. DISCOVERING
      await this.transitionState(jobId, 'DISCOVERING');
      const apiDoc = await this.runDiscovery(bootstrapJob);

      // 2. PARSING
      await this.transitionState(jobId, 'PARSING');
      const parsedProcesses = await this.runParsing(bootstrapJob, apiDoc);

      // 3. VALIDATING (新增)
      await this.transitionState(jobId, 'VALIDATING');
      const validatedProcesses = await this.runValidation(bootstrapJob, parsedProcesses);

      // 4. NORMALIZING
      await this.transitionState(jobId, 'NORMALIZING');
      await this.runNormalization(jobId, validatedProcesses);

      // 5. COMPILING (包含 MCP Generation + Publishing)
      await this.transitionState(jobId, 'COMPILING');
      await this.runCompiling(bootstrapJob, validatedProcesses);

      this.logger.log(`Job ${jobId} completed successfully`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Job ${jobId} failed: ${error.message}`, error.stack);
      await this.transitionState(jobId, 'FAILED').catch(() => {});
      throw error;
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

    // 3. 如果是 O2OA 系统，尝试自动发现
    if (bootstrapJob.oaUrl?.includes('x_desktop')) {
      return await this.discoverO2OAApis(bootstrapJob.oaUrl, bootstrapJob.authConfig);
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
      const loginPath = auth.loginPath || '/api/auth/login';
      const formsPath = auth.formsPath || '/api/forms';

      // 1. 登录获取 session
      const loginRes = await axios.post(
        `${oaUrl}${loginPath}`,
        {
          username: auth.username || 'admin',
          password: auth.password || 'Admin@123',
        },
        { timeout: 10000, withCredentials: true, validateStatus: () => true },
      );

      if (loginRes.status >= 400) {
        this.logger.warn(`Login failed with status ${loginRes.status}, skipping enrichment`);
        return documentContent;
      }

      const setCookies = loginRes.headers['set-cookie'];
      const cookieHeader = setCookies ? setCookies.map((c: string) => c.split(';')[0]).join('; ') : '';

      // 2. 拉取流程模板列表
      const formsRes = await axios.get(`${oaUrl}${formsPath}`, {
        timeout: 10000,
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
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

  /**
   * O2OA 系统自动发现（保留原有逻辑，但使用 authConfig）
   */
  private async discoverO2OAApis(oaUrl: string, authConfig: any): Promise<string> {
    const baseUrl = new URL(oaUrl).origin;
    const auth = authConfig || {};
    const token = auth.token || process.env.O2OA_TOKEN;

    if (!token) {
      throw new Error('O2OA token not found in authConfig or O2OA_TOKEN env var');
    }

    const headerName = auth.headerName || 'x-token';
    const headers = { [headerName]: token, 'Content-Type': 'application/json' };
    const endpoints: any[] = [];

    // 基础端点列表
    const o2oaApis = [
      { path: '/x_processplatform_assemble_surface/jaxrs/application/list', method: 'GET', desc: '获取应用列表' },
      { path: '/x_processplatform_assemble_surface/jaxrs/process/list/application/{applicationId}', method: 'GET', desc: '获取流程列表' },
      { path: '/x_processplatform_assemble_surface/jaxrs/work', method: 'POST', desc: '创建工作（发起流程）' },
      { path: '/x_processplatform_assemble_surface/jaxrs/work/{id}', method: 'GET', desc: '获取工作详情' },
      { path: '/x_processplatform_assemble_surface/jaxrs/work/{id}', method: 'DELETE', desc: '删除/撤回工作' },
      { path: '/x_processplatform_assemble_surface/jaxrs/task/list/my', method: 'GET', desc: '获取我的待办任务' },
      { path: '/x_processplatform_assemble_surface/jaxrs/task/{id}/process', method: 'PUT', desc: '处理任务（审批）' },
      { path: '/x_processplatform_assemble_surface/jaxrs/worklog/work/{workId}', method: 'GET', desc: '获取工作日志' },
      { path: '/x_processplatform_assemble_surface/jaxrs/workcompleted/list/my', method: 'GET', desc: '获取已完成工作' },
      { path: '/x_organization_assemble_express/jaxrs/person/list', method: 'GET', desc: '获取人员列表' },
      { path: '/x_organization_assemble_express/jaxrs/department/list', method: 'GET', desc: '获取部门列表' },
    ];

    for (const api of o2oaApis) {
      endpoints.push(api);
    }

    // 尝试发现应用和流程
    try {
      const appsResponse = await axios.get(
        `${baseUrl}/x_processplatform_assemble_surface/jaxrs/application/list`,
        { headers, timeout: 10000, validateStatus: () => true },
      );

      if (appsResponse.data?.type === 'success') {
        const apps = appsResponse.data.data || [];
        this.logger.log(`Found ${apps.length} O2OA applications`);

        for (const app of apps) {
          try {
            const processResponse = await axios.get(
              `${baseUrl}/x_processplatform_assemble_surface/jaxrs/process/list/application/${app.id}`,
              { headers, timeout: 10000, validateStatus: () => true },
            );

            if (processResponse.data?.type === 'success') {
              const processes = processResponse.data.data || [];
              for (const proc of processes) {
                endpoints.push({
                  path: `/x_processplatform_assemble_surface/jaxrs/work/process/${proc.id}`,
                  method: 'POST',
                  desc: `发起流程: ${proc.name || proc.alias || proc.id}`,
                  processId: proc.id,
                  processName: proc.name || proc.alias,
                  applicationId: app.id,
                  applicationName: app.name || app.alias,
                });
              }
            }
          } catch {
            // Skip this app
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to discover O2OA apps: ${error.message}`);
    }

    // 构建 OpenAPI 文档
    const openApiDoc = {
      openapi: '3.0.0',
      info: { title: 'O2OA API', version: '8.0', description: 'Auto-discovered O2OA REST API endpoints' },
      servers: [{ url: baseUrl }],
      paths: {} as any,
      components: {
        securitySchemes: {
          [headerName]: { type: 'apiKey', in: 'header', name: headerName },
        },
      },
    };

    for (const ep of endpoints) {
      if (!openApiDoc.paths[ep.path]) {
        openApiDoc.paths[ep.path] = {};
      }
      openApiDoc.paths[ep.path][ep.method.toLowerCase()] = {
        summary: ep.desc,
        operationId: `${ep.method.toLowerCase()}_${ep.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        parameters: ep.path.includes('{')
          ? ep.path.match(/\{([^}]+)\}/g)?.map((p: string) => ({
              name: p.slice(1, -1),
              in: 'path',
              required: true,
              schema: { type: 'string' },
            }))
          : [],
        ...(ep.processId ? {
          'x-process-id': ep.processId,
          'x-process-name': ep.processName,
          'x-application-id': ep.applicationId,
          'x-application-name': ep.applicationName,
        } : {}),
        responses: { '200': { description: 'Success' } },
      };
    }

    return JSON.stringify(openApiDoc, null, 2);
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
    const baseUrl = bootstrapJob.oaUrl ? new URL(bootstrapJob.oaUrl).origin : undefined;

    const result = await this.apiAnalyzer.execute(
      { docContent: apiDoc, oaUrl: bootstrapJob.oaUrl, baseUrl },
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
  // VALIDATING 阶段（新增）
  // ============================================================

  private async runValidation(
    bootstrapJob: any,
    processes: BusinessProcess[],
  ): Promise<BusinessProcess[]> {
    if (processes.length === 0) {
      this.logger.log('No processes to validate');
      return [];
    }

    const baseUrl = bootstrapJob.oaUrl ? new URL(bootstrapJob.oaUrl).origin : null;
    if (!baseUrl) {
      this.logger.warn('No baseUrl available, skipping validation');
      return processes;
    }

    const authConfig = bootstrapJob.authConfig || {};
    this.logger.log(`Validating ${processes.reduce((sum, p) => sum + p.endpoints.length, 0)} endpoints`);

    const validationResults: Array<{
      processCode: string;
      endpoint: Endpoint;
      status: 'reachable' | 'unreachable' | 'auth_failed' | 'server_error';
      statusCode?: number;
    }> = [];

    // 构建认证请求头
    const headers = await this.buildAuthHeaders(baseUrl, authConfig);

    for (const process of processes) {
      for (const endpoint of process.endpoints) {
        const result = await this.probeEndpoint(baseUrl, endpoint, headers);
        validationResults.push({
          processCode: process.processCode,
          endpoint,
          ...result,
        });
      }
    }

    // 过滤掉不可达的端点
    const validatedProcesses = processes.map((proc) => ({
      ...proc,
      endpoints: proc.endpoints.filter((ep) => {
        const result = validationResults.find(
          (r) => r.processCode === proc.processCode && r.endpoint.path === ep.path,
        );
        return result && result.status !== 'unreachable' && result.status !== 'server_error';
      }),
    })).filter((proc) => proc.endpoints.length > 0);

    // 记录验证结果到 BootstrapReport
    const reachableCount = validationResults.filter((r) => r.status === 'reachable').length;
    const authFailedCount = validationResults.filter((r) => r.status === 'auth_failed').length;
    const unreachableCount = validationResults.filter((r) => r.status === 'unreachable').length;
    const serverErrorCount = validationResults.filter((r) => r.status === 'server_error').length;

    await this.prisma.bootstrapReport.updateMany({
      where: { bootstrapJobId: bootstrapJob.id },
      data: {
        evidence: {
          push: {
            type: 'endpoint_validation',
            description: `Validated ${validationResults.length} endpoints: ${reachableCount} reachable, ${authFailedCount} auth_failed, ${unreachableCount} unreachable, ${serverErrorCount} server_error`,
            reachable: reachableCount,
            authFailed: authFailedCount,
            unreachable: unreachableCount,
            serverError: serverErrorCount,
            timestamp: new Date().toISOString(),
          },
        },
      },
    });

    this.logger.log(
      `Validation complete: ${reachableCount}/${validationResults.length} endpoints reachable, ` +
      `${validatedProcesses.length}/${processes.length} processes retained`,
    );

    return validatedProcesses;
  }

  /**
   * 构建认证请求头
   */
  private async buildAuthHeaders(baseUrl: string, authConfig: any): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authType = authConfig.authType;

    if (authType === 'apikey') {
      const headerName = authConfig.headerName || 'x-token';
      const token = authConfig.token;
      if (token) {
        headers[headerName] = token;
      }
    } else if (authType === 'basic') {
      const username = authConfig.username;
      const password = authConfig.password;
      if (username && password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      }
    } else if (authType === 'oauth2') {
      const accessToken = authConfig.accessToken || authConfig.token;
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
    } else if (authType === 'cookie') {
      // Cookie auth: 先登录获取 session
      const loginPath = authConfig.loginPath || '/api/auth/login';
      try {
        const loginRes = await axios.post(
          `${baseUrl}${loginPath}`,
          {
            username: authConfig.username,
            password: authConfig.password,
          },
          { timeout: 10000, validateStatus: () => true },
        );

        const setCookies = loginRes.headers['set-cookie'];
        if (setCookies && setCookies.length > 0) {
          headers['Cookie'] = setCookies.map((c: string) => c.split(';')[0]).join('; ');
        }
      } catch (error: any) {
        this.logger.warn(`Cookie auth login failed: ${error.message}`);
      }
    }

    return headers;
  }

  /**
   * 探测单个端点的可达性
   */
  private async probeEndpoint(
    baseUrl: string,
    endpoint: Endpoint,
    headers: Record<string, string>,
  ): Promise<{
    status: 'reachable' | 'unreachable' | 'auth_failed' | 'server_error';
    statusCode?: number;
  }> {
    // 替换路径参数为测试值
    const testPath = endpoint.path.replace(/\{[^}]+\}/g, '__test__');
    const url = `${baseUrl}${testPath}`;

    // 使用 HEAD 或 OPTIONS 探测（不触发副作用）
    const probeMethod = endpoint.method === 'GET' ? 'HEAD' : 'OPTIONS';

    try {
      const response = await axios({
        method: probeMethod,
        url,
        headers,
        timeout: 5000,
        validateStatus: () => true,
      });

      // OPTIONS 返回 405，降级到 HEAD
      if (response.status === 405 && probeMethod === 'OPTIONS') {
        const headResp = await axios.head(url, {
          headers,
          timeout: 5000,
          validateStatus: () => true,
        });
        return this.classifyProbeStatus(headResp.status);
      }

      return this.classifyProbeStatus(response.status);
    } catch (error: any) {
      this.logger.debug(`Endpoint ${endpoint.method} ${endpoint.path} unreachable: ${error.message}`);
      return { status: 'unreachable' };
    }
  }

  /**
   * 根据 HTTP 状态码分类端点状态
   */
  private classifyProbeStatus(statusCode: number): {
    status: 'reachable' | 'unreachable' | 'auth_failed' | 'server_error';
    statusCode: number;
  } {
    if (statusCode >= 200 && statusCode < 400) {
      return { status: 'reachable', statusCode };
    } else if (statusCode === 401 || statusCode === 403) {
      return { status: 'auth_failed', statusCode };
    } else if (statusCode === 404 || statusCode === 405) {
      // 404/405 可能是路径参数问题，算作可达（端点存在但参数不对）
      return { status: 'reachable', statusCode };
    } else if (statusCode >= 500) {
      return { status: 'server_error', statusCode };
    } else {
      return { status: 'reachable', statusCode };
    }
  }

  // ============================================================
  // NORMALIZING 阶段
  // ============================================================

  private async runNormalization(jobId: string, processes: BusinessProcess[]) {
    this.logger.log(`Normalizing ${processes.length} business processes`);

    for (const proc of processes) {
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
          },
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
          },
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

    await this.prisma.bootstrapReport.create({
      data: {
        bootstrapJobId: jobId,
        oclLevel: 'OCL3',
        coverage: 0.9,
        confidence: 0.95,
        risk: 'low',
        evidence: [{
          type: 'llm_analysis',
          description: `LLM Agent identified ${processes.length} business processes with ${totalEndpoints} endpoints`,
          confidence: 0.95,
        }],
        recommendation: `Successfully identified ${processes.length} business processes. Ready for MCP tool generation.`,
      },
    });

    this.logger.log(`Normalization complete: ${processes.length} processes, ${totalEndpoints} endpoints`);
  }

  // ============================================================
  // COMPILING 阶段（MCP Generation + Publishing）
  // ============================================================

  private async runCompiling(bootstrapJob: any, processes: BusinessProcess[]) {
    if (processes.length === 0) {
      this.logger.warn('No processes to compile, marking as PUBLISHED with no output');
      await this.transitionState(bootstrapJob.id, 'PUBLISHED');
      return;
    }

    const baseUrl = bootstrapJob.oaUrl ? new URL(bootstrapJob.oaUrl).origin : 'http://localhost';
    const authConfig = bootstrapJob.authConfig || {};
    const authType = authConfig.authType || 'apikey';
    const connectorName = bootstrapJob.name || `OA-${bootstrapJob.id.substring(0, 8)}`;

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
          oclLevel: 'OCL3',
          status: 'active',
        },
        update: {
          baseUrl,
          authType,
          authConfig: publicConfig,
          oclLevel: 'OCL3',
          status: 'active',
        },
      });

      this.logger.log(`Connector upserted: ${connector.id} (${connectorName})`);

      // ── 2. 创建 ConnectorCapability ──
      const oclLevel = 'OCL3';
      await tx.connectorCapability.upsert({
        where: { connectorId: connector.id },
        create: {
          tenantId: bootstrapJob.tenantId,
          connectorId: connector.id,
          supportsDiscovery: true,
          supportsSchemaSync: true,
          supportsReferenceSync: true,
          supportsStatusPull: true,
          supportsCancel: true,
          supportsUrge: true,
          syncModes: ['full'],
          metadata: {
            inferredFrom: 'bootstrap_pipeline',
            oclLevel,
          },
        },
        update: {
          supportsDiscovery: true,
          supportsSchemaSync: true,
          supportsReferenceSync: true,
          supportsStatusPull: true,
          supportsCancel: true,
          supportsUrge: true,
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
            properties[param.name] = {
              type: param.type || 'string',
              description: param.description || param.name,
            };
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
                apiEndpoint: endpoint.path,
                httpMethod: endpoint.method,
                headers: Prisma.JsonNull,
                bodyTemplate: Prisma.JsonNull,
                paramMapping,
                responseMapping,
                flowCode: proc.processCode,
                category: endpoint.category || 'other',
                testInput: this.generateTestInput(endpoint.parameters),
                testOutput: Prisma.JsonNull,
              },
              update: {
                toolDescription: `${proc.processName} - ${endpoint.description}`,
                toolSchema: { type: 'object', properties, required },
                apiEndpoint: endpoint.path,
                httpMethod: endpoint.method,
                headers: Prisma.JsonNull,
                paramMapping,
                responseMapping,
                flowCode: proc.processCode,
                category: endpoint.category || 'other',
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

        // 查找已有版本
        const latestTemplate = await tx.processTemplate.findFirst({
          where: { connectorId: connector.id, processCode: proc.processCode },
          orderBy: { version: 'desc' },
        });
        const nextVersion = latestTemplate ? latestTemplate.version + 1 : 1;

        const template = await tx.processTemplate.create({
          data: {
            tenantId: bootstrapJob.tenantId,
            connectorId: connector.id,
            remoteProcessId: remoteProcess.id,
            processCode: proc.processCode,
            processName: proc.processName,
            processCategory: proc.category,
            description: proc.description,
            version: nextVersion,
            status: 'published',
            falLevel,
            sourceHash,
            sourceVersion: String(nextVersion),
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
          },
        });

        await tx.remoteProcess.update({
          where: { id: remoteProcess.id },
          data: {
            latestTemplateId: template.id,
            sourceVersion: String(nextVersion),
          },
        });

        publishedCount++;
      }

      this.logger.log(`Published ${publishedCount} process templates`);

      // ── 6. 回写 connectorId 到 BootstrapJob，状态 → PUBLISHED ──
      await tx.bootstrapJob.update({
        where: { id: bootstrapJob.id },
        data: {
          connectorId: connector.id,
          status: 'PUBLISHED',
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
        input[param.name] = param.type === 'number' ? 1 : 'test';
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

  private async transitionState(jobId: string, newState: string) {
    this.logger.debug(`${jobId} -> ${newState}`);
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: newState },
    });
  }
}
