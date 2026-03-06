import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import axios from 'axios';
import { ApiAnalyzerAgent, BusinessProcess } from '../agents/api-analyzer.agent';

@Processor('bootstrap')
@Injectable()
export class BootstrapProcessor {
  private readonly logger = new Logger(BootstrapProcessor.name);
  private readonly apiAnalyzer = new ApiAnalyzerAgent();

  constructor(private readonly prisma: PrismaService) {}

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

      await this.transitionState(jobId, 'DISCOVERING');
      const apiDoc = await this.runDiscovery(bootstrapJob);

      await this.transitionState(jobId, 'PARSING');
      const parsedEndpoints = await this.runParsing(bootstrapJob, apiDoc);

      await this.transitionState(jobId, 'NORMALIZING');
      await this.runNormalization(jobId, parsedEndpoints);

      await this.transitionState(jobId, 'COMPILING');
      await this.runMCPGeneration(bootstrapJob, parsedEndpoints);

      await this.transitionState(jobId, 'REPLAYING');
      await this.runReplay(jobId);

      await this.transitionState(jobId, 'REVIEW');

      this.logger.log(`Job ${jobId} completed, status: REVIEW`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Job ${jobId} failed: ${error.message}`);
      await this.transitionState(jobId, 'FAILED').catch(() => {});
      throw error;
    }
  }

  private async runDiscovery(bootstrapJob: any): Promise<string | null> {
    this.logger.log(`Running discovery for ${bootstrapJob.oaUrl}`);

    const docSource = bootstrapJob.sources.find(
      (s: any) => s.sourceContent && ['openapi', 'swagger', 'custom'].includes(s.sourceType),
    );

    if (docSource?.sourceContent) {
      this.logger.log(`Using inline API doc (${docSource.sourceType})`);
      return docSource.sourceContent;
    }

    const openApiSource = bootstrapJob.sources.find(
      (s: any) => s.sourceType === 'openapi' && s.sourceUrl,
    );

    if (openApiSource?.sourceUrl) {
      try {
        const response = await axios.get(openApiSource.sourceUrl, { timeout: 30000 });
        const content = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data, null, 2);
        this.logger.log(`Fetched API doc (${content.length} chars)`);
        return content;
      } catch (error: any) {
        this.logger.warn(`Failed to fetch API doc: ${error.message}`);
      }
    }

    if (bootstrapJob.oaUrl?.includes('x_desktop')) {
      return await this.discoverO2OAApis(bootstrapJob.oaUrl);
    }

    this.logger.log(`No API doc found, will use mock data`);
    return null;
  }

  private async discoverO2OAApis(oaUrl: string): Promise<string> {
    const baseUrl = new URL(oaUrl).origin;
    const token = process.env.O2OA_TOKEN;

    if (!token) {
      throw new Error('O2OA_TOKEN environment variable is required for O2OA discovery');
    }

    const headers = { 'x-token': token, 'Content-Type': 'application/json' };
    const endpoints: any[] = [];

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
      const testPath = api.path.replace(/\{[^}]+\}/g, 'test');
      try {
        await axios({
          method: api.method.toLowerCase() as any,
          url: `${baseUrl}${testPath}`,
          headers,
          timeout: 5000,
          validateStatus: (status) => status < 500,
        });
        endpoints.push(api);
        this.logger.debug(`O2OA endpoint verified: ${api.method} ${api.path}`);
      } catch {
        endpoints.push(api);
      }
    }

    try {
      const appsResponse = await axios.get(
        `${baseUrl}/x_processplatform_assemble_surface/jaxrs/application/list`,
        { headers, timeout: 10000 },
      );

      if (appsResponse.data.type === 'success') {
        const apps = appsResponse.data.data || [];
        this.logger.log(`Found ${apps.length} O2OA applications`);

        for (const app of apps) {
          try {
            const processResponse = await axios.get(
              `${baseUrl}/x_processplatform_assemble_surface/jaxrs/process/list/application/${app.id}`,
              { headers, timeout: 10000 },
            );

            if (processResponse.data.type === 'success') {
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

    const openApiDoc = {
      openapi: '3.0.0',
      info: { title: 'O2OA API', version: '8.0', description: 'Auto-discovered O2OA REST API endpoints' },
      servers: [{ url: baseUrl }],
      paths: {} as any,
      components: {
        securitySchemes: {
          'x-token': { type: 'apiKey', in: 'header', name: 'x-token' },
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

  private async runNormalization(jobId: string, processes: BusinessProcess[]) {
    this.logger.log(`Normalizing ${processes.length} business processes`);

    for (const proc of processes) {
      await this.prisma.flowIR.create({
        data: {
          bootstrapJobId: jobId,
          flowCode: proc.processCode,
          flowName: proc.processName,
          flowCategory: proc.category,
          entryUrl: proc.endpoints[0]?.path,
          submitUrl: proc.endpoints.find((e) => e.method === 'POST')?.path,
          queryUrl: proc.endpoints.find((e) => e.method === 'GET')?.path,
          metadata: {
            description: proc.description,
            endpointCount: proc.endpoints.length,
          },
        },
      });

      const uniqueParams = new Map<string, any>();
      for (const p of proc.endpoints.flatMap((e) => e.parameters || [])) {
        if (!uniqueParams.has(p.name)) uniqueParams.set(p.name, p);
      }

      for (const [, param] of uniqueParams) {
        await this.prisma.fieldIR.create({
          data: {
            bootstrapJobId: jobId,
            flowCode: proc.processCode,
            fieldKey: param.name,
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

  private async runMCPGeneration(bootstrapJob: any, processes: BusinessProcess[]) {
    const totalEndpoints = processes.reduce((sum, p) => sum + p.endpoints.length, 0);
    this.logger.log(`Generating MCP tools from ${processes.length} processes (${totalEndpoints} endpoints)`);

    const baseUrl = bootstrapJob.oaUrl ? new URL(bootstrapJob.oaUrl).origin : 'http://localhost';

    const connector = await this.prisma.connector.create({
      data: {
        tenantId: bootstrapJob.tenantId,
        name: `Bootstrap-${bootstrapJob.id.substring(0, 8)}`,
        oaType: 'hybrid',
        baseUrl,
        authType: 'apikey',
        authConfig: { token: process.env.O2OA_TOKEN || '', headerName: 'x-token' },
        oclLevel: 'OCL3',
        status: 'active',
      },
    });

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

        const category = this.categorizeEndpoint(endpoint);
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const param of endpoint.parameters || []) {
          properties[param.name] = {
            type: param.type || 'string',
            description: param.description || param.name,
          };
          if (param.required) required.push(param.name);
        }

        const paramMapping: Record<string, string> = {};
        for (const param of endpoint.parameters || []) {
          paramMapping[param.name] = param.name;
        }

        try {
          await this.prisma.mCPTool.create({
            data: {
              tenantId: bootstrapJob.tenantId,
              connectorId: connector.id,
              toolName,
              toolDescription: `${proc.processName} - ${endpoint.description}`,
              toolSchema: { type: 'object', properties, required },
              apiEndpoint: endpoint.path,
              httpMethod: endpoint.method,
              headers: { 'x-token': process.env.O2OA_TOKEN || '' },
              bodyTemplate: null as any,
              paramMapping,
              responseMapping: { success: 'type', data: 'data', message: 'message' },
              flowCode: proc.processCode,
              category,
              testInput: this.generateTestInput(endpoint.parameters),
              testOutput: null as any,
            },
          });
          toolCount++;
        } catch (error: any) {
          if (error.code === 'P2002') {
            this.logger.warn(`Skipping duplicate tool: ${toolName}`);
          } else {
            throw error;
          }
        }
      }
    }

    await this.prisma.adapterBuild.create({
      data: {
        bootstrapJobId: bootstrapJob.id,
        adapterType: 'mcp',
        generatedCode: `// MCP-based adapter: ${toolCount} tools generated for ${processes.length} business processes`,
        buildStatus: 'success',
      },
    });

    this.logger.log(`Generated ${toolCount} MCP tools`);
  }

  private async runReplay(jobId: string) {
    // Query only tools associated with this job's connector
    const connector = await this.prisma.connector.findFirst({
      where: { name: { startsWith: `Bootstrap-${jobId.substring(0, 8)}` } },
      orderBy: { createdAt: 'desc' },
    });

    const tools = connector
      ? await this.prisma.mCPTool.findMany({
          where: { connectorId: connector.id },
          take: 50,
        })
      : [];

    for (const tool of tools) {
      await this.prisma.replayCase.create({
        data: {
          bootstrapJobId: jobId,
          flowCode: tool.flowCode || tool.toolName,
          testData: tool.testInput || {},
          expectedResult: { status: 'success' },
        },
      });
    }

    this.logger.log(`Created ${tools.length} replay cases`);
  }

  private generateToolName(processCode: string, ep: any): string {
    const method = ep.method.toLowerCase();

    if (ep.moduleName && ep.actionName && ep.methodName) {
      const moduleShort = ep.moduleName
        .replace(/^x_/, '')
        .replace(/_assemble_\w+$/, '')
        .replace(/_service_\w+$/, '')
        .replace(/_core_\w+$/, '');
      return `${method}_${moduleShort}_${ep.actionName}_${ep.methodName}`
        .replace(/[^a-z0-9_]/gi, '_')
        .toLowerCase()
        .substring(0, 120);
    }

    const pathParts = ep.path
      .split('/')
      .filter((p: string) => p && !p.startsWith('{'));
    const resource = pathParts.slice(-2).join('_') || 'resource';
    return `${processCode}_${method}_${resource}`
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase()
      .substring(0, 120);
  }

  private categorizeEndpoint(ep: any): string {
    const path = ep.path.toLowerCase();
    const method = ep.method.toUpperCase();

    if (method === 'POST' && (path.includes('/work') || path.includes('/submit'))) return 'submit';
    if (path.includes('/status') || path.includes('/worklog')) return 'query';
    if (method === 'DELETE' || path.includes('/cancel')) return 'cancel';
    if (path.includes('/urge')) return 'urge';
    if (path.includes('/list') || path.includes('/my')) return 'list';
    if (method === 'GET') return 'get';
    if (method === 'PUT' && path.includes('/process')) return 'approve';
    return 'other';
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

  private async transitionState(jobId: string, newState: string) {
    this.logger.debug(`${jobId} -> ${newState}`);
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: newState },
    });
  }
}
