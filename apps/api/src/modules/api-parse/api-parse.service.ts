import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { DocNormalizerService } from './doc-normalizer.service';
import { WorkflowIdentifierAgent } from './workflow-identifier.agent';
import { EndpointValidatorService } from './endpoint-validator.service';
import { MCPGeneratorService } from './mcp-generator.service';
import {
  GenerateResult,
  IdentifyResult,
  NormalizeResult,
  ParseAndGenerateInput,
  ParseAndGenerateOutput,
  ValidationReport,
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

  async parseAndGenerate(input: ParseAndGenerateInput): Promise<ParseAndGenerateOutput> {
    const warnings: string[] = [];
    const connector = await this.getConnector(input.connectorId, input.tenantId);

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

    this.logger.log(
      `Stage 1 complete: ${normalizeResult.endpoints.length} endpoints, format=${normalizeResult.format}`,
    );

    if (normalizeResult.baseUrl && !input.baseUrl && normalizeResult.baseUrl !== connector.baseUrl) {
      await this.prisma.connector.updateMany({
        where: {
          id: connector.id,
          tenantId: input.tenantId,
        },
        data: { baseUrl: normalizeResult.baseUrl },
      });
    }

    this.logger.log(
      `Stage 2: Identifying workflows from ${normalizeResult.endpoints.length} endpoints`,
    );
    const identifyResult = await this.workflowIdentifier.identify(normalizeResult.endpoints);

    if (identifyResult.workflows.length === 0) {
      warnings.push('No business workflows identified from endpoints');
    }

    this.logger.log(`Stage 2 complete: ${identifyResult.workflows.length} workflows identified`);

    let validation: ValidationReport | undefined;
    if (input.autoValidate === true) {
      this.logger.log(`Stage 3: Validating endpoints for connector ${input.connectorId}`);
      try {
        validation = await this.endpointValidator.validate(
          input.connectorId,
          input.tenantId,
          false,
        );
        if (validation.overall === 'failed') {
          warnings.push(
            `Endpoint validation failed: connectivity=${validation.connectivity}, auth=${validation.authValid}`,
          );
        } else if (validation.overall === 'partial') {
          warnings.push(
            `${validation.summary.unreachable} of ${validation.summary.total} endpoints unreachable`,
          );
        }
        this.logger.log(
          `Stage 3 complete: ${validation.overall} (${validation.summary.reachable}/${validation.summary.total} reachable)`,
        );
      } catch (error: any) {
        warnings.push(`Endpoint validation skipped: ${error.message}`);
        this.logger.warn(`Stage 3 skipped: ${error.message}`);
      }
    }

    this.logger.log(
      `Stage 4: Generating MCP tools for ${identifyResult.workflows.length} workflows`,
    );
    const generateResult = await this.mcpGenerator.generate(
      input.tenantId,
      input.connectorId,
      identifyResult.workflows,
      identifyResult.syncCapabilities,
      input.baseUrl || normalizeResult.baseUrl || connector.baseUrl,
    );

    this.logger.log(
      `Stage 4 complete: ${generateResult.tools.length} tools, ${generateResult.processTemplates.length} templates`,
    );

    return this.buildOutput(
      normalizeResult,
      identifyResult,
      generateResult,
      validation,
      warnings,
    );
  }

  async previewNormalize(content: string, formatHint?: string): Promise<NormalizeResult> {
    return this.docNormalizer.normalize(content, formatHint);
  }

  async validateConnector(connectorId: string, tenantId: string): Promise<ValidationReport> {
    await this.getConnector(connectorId, tenantId);
    return this.endpointValidator.validate(connectorId, tenantId, false);
  }

  private async resolveDocContent(input: ParseAndGenerateInput): Promise<string | null> {
    if (input.docContent) {
      return input.docContent;
    }

    if (input.docUrl) {
      try {
        const response = await axios.get(input.docUrl, { timeout: 30000 });
        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
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
    const workflows = identify.workflows.map((workflow) => ({
      processCode: workflow.processCode,
      processName: workflow.processName,
      category: workflow.category,
      confidence: workflow.confidence,
      tools: generate.tools
        .filter((tool) => tool.flowCode === workflow.processCode)
        .map((tool) => ({
          toolName: tool.toolName,
          category: tool.category,
          validated: validation?.endpoints.find(
            (endpoint) =>
              endpoint.path === tool.apiEndpoint && endpoint.method === tool.httpMethod,
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

  private async getConnector(connectorId: string, tenantId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
      },
      select: {
        id: true,
        baseUrl: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    return connector;
  }
}
