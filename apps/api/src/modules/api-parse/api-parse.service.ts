import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DocNormalizerService } from './doc-normalizer.service';
import { WorkflowIdentifierAgent } from './workflow-identifier.agent';
import { EndpointValidatorService } from './endpoint-validator.service';
import { MCPGeneratorService } from './mcp-generator.service';
import {
  ParseAndGenerateInput,
  ParseAndGenerateOutput,
  NormalizeResult,
  IdentifyResult,
  ValidationReport,
  GenerateResult,
} from './types';

@Injectable()
export class ApiParseService {
  private readonly logger = new Logger(ApiParseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docNormalizer: DocNormalizerService,
    private readonly workflowIdentifier: WorkflowIdentifierAgent,
    private readonly endpointValidator: EndpointValidatorService,
    private readonly mcpGenerator: MCPGeneratorService,
  ) {}

  /**
   * 完整流水线：文档标准化 → 流程识别 → 端点验证 → MCP 生成
   */
  async parseAndGenerate(input: ParseAndGenerateInput): Promise<ParseAndGenerateOutput> {
    const warnings: string[] = [];

    // ── Stage 1: 文档标准化 ──────────────────────────────────
    const docContent = await this.resolveDocContent(input);
    if (!docContent) {
      return this.emptyOutput('No document content provided', warnings);
    }

    this.logger.log(`Stage 1: Normalizing document for connector ${input.connectorId}`);
    const normalizeResult = await this.docNormalizer.normalize(docContent);

    if (normalizeResult.endpoints.length === 0) {
      warnings.push('No endpoints found in document');
      return this.emptyOutput('No endpoints extracted', warnings);
    }

    this.logger.log(`Stage 1 complete: ${normalizeResult.endpoints.length} endpoints, format=${normalizeResult.format}`);

    // 更新 connector baseUrl（如果文档中检测到且用户未指定）
    if (normalizeResult.baseUrl && !input.baseUrl) {
      await this.prisma.connector.update({
        where: { id: input.connectorId },
        data: { baseUrl: normalizeResult.baseUrl },
      });
    }

    // ── Stage 2: 业务流程识别 ────────────────────────────────
    this.logger.log(`Stage 2: Identifying workflows from ${normalizeResult.endpoints.length} endpoints`);
    const identifyResult = await this.workflowIdentifier.identify(normalizeResult.endpoints);

    if (identifyResult.workflows.length === 0) {
      warnings.push('No business workflows identified from endpoints');
    }

    if (identifyResult.filteredCount > 0) {
      warnings.push(`${identifyResult.filteredCount} system/admin endpoints filtered out`);
    }

    this.logger.log(`Stage 2 complete: ${identifyResult.workflows.length} workflows identified`);

    // ── Stage 3: 端点验证（可选，默认跳过因为 bootstrap 已经做过深度验证） ────────────────────────────
    let validation: ValidationReport | undefined;
    if (input.autoValidate === true) {
      this.logger.log(`Stage 3: Validating endpoints for connector ${input.connectorId}`);
      try {
        validation = await this.endpointValidator.validate(input.connectorId, false); // skipProbe=false 强制重新探测
        if (validation.overall === 'failed') {
          warnings.push(`Endpoint validation failed: connectivity=${validation.connectivity}, auth=${validation.authValid}`);
        } else if (validation.overall === 'partial') {
          warnings.push(`${validation.summary.unreachable} of ${validation.summary.total} endpoints unreachable`);
        }
        this.logger.log(`Stage 3 complete: ${validation.overall} (${validation.summary.reachable}/${validation.summary.total} reachable)`);
      } catch (error: any) {
        warnings.push(`Endpoint validation skipped: ${error.message}`);
        this.logger.warn(`Stage 3 skipped: ${error.message}`);
      }
    }

    // ── Stage 4: MCP 生成 ────────────────────────────────────
    this.logger.log(`Stage 4: Generating MCP tools for ${identifyResult.workflows.length} workflows`);
    const generateResult = await this.mcpGenerator.generate(
      input.tenantId,
      input.connectorId,
      identifyResult.workflows,
      identifyResult.syncCapabilities,
    );

    this.logger.log(`Stage 4 complete: ${generateResult.tools.length} tools, ${generateResult.processTemplates.length} templates`);

    // ── 组装输出 ─────────────────────────────────────────────
    return this.buildOutput(normalizeResult, identifyResult, generateResult, validation, warnings);
  }

  /**
   * 仅执行 Stage 1: 文档标准化（预览用）
   */
  async previewNormalize(content: string, formatHint?: string): Promise<NormalizeResult> {
    return this.docNormalizer.normalize(content, formatHint);
  }

  /**
   * 仅执行 Stage 3: 端点验证（手动触发）
   */
  async validateConnector(connectorId: string): Promise<ValidationReport> {
    return this.endpointValidator.validate(connectorId, false); // skipProbe=false 强制探测
  }

  // ── 辅助方法 ──────────────────────────────────────────────

  private async resolveDocContent(input: ParseAndGenerateInput): Promise<string | null> {
    if (input.docContent) return input.docContent;

    if (input.docUrl) {
      try {
        const response = await fetch(input.docUrl);
        if (!response.ok) return null;
        return response.text();
      } catch (error: any) {
        this.logger.error(`Failed to fetch doc from ${input.docUrl}: ${error.message}`);
        return null;
      }
    }

    return null;
  }

  private buildOutput(
    normalize: NormalizeResult,
    identify: IdentifyResult,
    generate: GenerateResult,
    validation: ValidationReport | undefined,
    warnings: string[],
  ): ParseAndGenerateOutput {
    // 将 workflow 和 tool 信息关联
    const workflows = identify.workflows.map(w => ({
      processCode: w.processCode,
      processName: w.processName,
      category: w.category,
      confidence: w.confidence,
      tools: generate.tools
        .filter(t => t.flowCode === w.processCode)
        .map(t => ({
          toolName: t.toolName,
          category: t.category,
          validated: validation?.endpoints.find(
            e => e.path === t.apiEndpoint && e.method === t.httpMethod,
          )?.status,
        })),
    }));

    return {
      detectedFormat: normalize.format,
      totalEndpoints: normalize.rawEndpointCount,
      identifiedWorkflows: identify.workflows.length,
      generatedTools: generate.tools.length,
      workflows,
      syncStrategy: generate.syncStrategy,
      validation,
      warnings,
    };
  }

  private emptyOutput(reason: string, warnings: string[]): ParseAndGenerateOutput {
    warnings.push(reason);
    return {
      detectedFormat: 'unknown-text',
      totalEndpoints: 0,
      identifiedWorkflows: 0,
      generatedTools: 0,
      workflows: [],
      syncStrategy: { primary: 'manual', fallback: null, pollingIntervalMs: 0 },
      warnings,
    };
  }
}
