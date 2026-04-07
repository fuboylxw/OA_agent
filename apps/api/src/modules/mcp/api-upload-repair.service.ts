import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, type BaseLLMClient } from '@uniflow/agent-kernel';
import type { DocFormat } from '../api-parse/types';
import { DocNormalizerService } from '../api-parse/doc-normalizer.service';
import { ApiDocParserAgent } from './agents/api-doc-parser.agent';
import { WorkflowApiIdentifierAgent } from './agents/workflow-api-identifier.agent';

export interface ApiUploadRepairInput {
  tenantId: string;
  connectorId: string;
  sourceName?: string;
  docType: 'openapi' | 'swagger' | 'postman' | 'custom';
  docContent: string;
  oaUrl: string;
  maxAttempts?: number;
}

export interface ApiUploadRepairAction {
  action: string;
  reason: string;
  target?: string;
  diffSummary?: string;
  applied: boolean;
}

export interface ApiUploadDiagnostics {
  formatDetected: DocFormat;
  parseErrors: string[];
  schemaErrors: string[];
  refErrors: string[];
  missingFields: string[];
  suspiciousSections: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface ApiUploadRepairEvaluation {
  effectiveDocType: 'openapi' | 'swagger' | 'postman' | 'custom';
  parseSuccess: boolean;
  endpointCount: number;
  workflowCount: number;
  validationScore: number;
  diagnostics: ApiUploadDiagnostics;
  parseError?: string;
}

export interface ApiUploadRepairAttemptResult {
  stage: 'repairing_deterministic' | 'repairing_llm';
  strategy: 'deterministic' | 'llm';
  content: string;
  actions: ApiUploadRepairAction[];
  evaluation: ApiUploadRepairEvaluation;
}

export interface ApiUploadRepairLoopResult {
  attempts: ApiUploadRepairAttemptResult[];
  accepted?: {
    content: string;
    effectiveDocType: 'openapi' | 'swagger' | 'postman' | 'custom';
    endpointCount: number;
    workflowCount: number;
    validationScore: number;
  };
  finalErrorType?: string;
  finalErrorMessage?: string;
}

@Injectable()
export class ApiUploadRepairService {
  private readonly logger = new Logger(ApiUploadRepairService.name);
  private llmClient: BaseLLMClient | null = null;

  constructor(
    private readonly docNormalizer: DocNormalizerService,
    private readonly apiDocParser: ApiDocParserAgent,
    private readonly workflowIdentifier: WorkflowApiIdentifierAgent,
  ) {
    if (this.isLlmConfigured()) {
      this.llmClient = LLMClientFactory.createFromEnv();
    }
  }

  async runRepairLoop(input: ApiUploadRepairInput): Promise<ApiUploadRepairLoopResult> {
    const attempts: ApiUploadRepairAttemptResult[] = [];
    let currentContent = input.docContent;
    let bestEvaluation: ApiUploadRepairEvaluation | null = null;
    const maxAttempts = Math.min(Math.max(input.maxAttempts || 3, 1), 5);

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      const strategy = this.resolveStrategy(attemptNo);
      if (strategy === 'llm' && !this.llmClient) {
        break;
      }

      const repaired = strategy === 'deterministic'
        ? this.applyDeterministicRepair(currentContent, input)
        : await this.applyLlmRepair(currentContent, input, bestEvaluation);
      const evaluation = await this.evaluateCandidate(repaired.content, input);

      attempts.push({
        stage: strategy === 'deterministic' ? 'repairing_deterministic' : 'repairing_llm',
        strategy,
        content: repaired.content,
        actions: repaired.actions,
        evaluation,
      });

      if (this.shouldAccept(evaluation)) {
        return {
          attempts,
          accepted: {
            content: repaired.content,
            effectiveDocType: evaluation.effectiveDocType,
            endpointCount: evaluation.endpointCount,
            workflowCount: evaluation.workflowCount,
            validationScore: evaluation.validationScore,
          },
        };
      }

      if (!this.shouldContinue(bestEvaluation, evaluation, strategy, attemptNo, maxAttempts)) {
        return {
          attempts,
          finalErrorType: evaluation.parseSuccess ? 'manual_review_required' : 'parse_failed_after_repair',
          finalErrorMessage: evaluation.parseError || 'Automatic repair could not produce an acceptable API document',
        };
      }

      currentContent = repaired.content;
      bestEvaluation = this.pickBetterEvaluation(bestEvaluation, evaluation);
    }

    return {
      attempts,
      finalErrorType: 'repair_attempts_exhausted',
      finalErrorMessage: 'Automatic repair attempts exhausted without reaching an acceptable result',
    };
  }

  private resolveStrategy(attemptNo: number): 'deterministic' | 'llm' {
    return attemptNo === 1 || attemptNo === 3 ? 'deterministic' : 'llm';
  }

  private applyDeterministicRepair(content: string, input: ApiUploadRepairInput) {
    const actions: ApiUploadRepairAction[] = [];
    let next = content;

    const strippedBom = next.replace(/^\uFEFF/, '');
    if (strippedBom !== next) {
      next = strippedBom;
      actions.push({
        action: 'strip_bom',
        reason: 'Remove UTF-8 BOM before parsing',
        applied: true,
      });
    }

    const normalizedLineEndings = next.replace(/\r\n/g, '\n');
    if (normalizedLineEndings !== next) {
      next = normalizedLineEndings;
      actions.push({
        action: 'normalize_line_endings',
        reason: 'Normalize CRLF to LF for stable parsing',
        applied: true,
      });
    }

    const withoutControlChars = next.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (withoutControlChars !== next) {
      next = withoutControlChars;
      actions.push({
        action: 'remove_control_chars',
        reason: 'Drop illegal control characters from document content',
        applied: true,
      });
    }

    const withoutTrailingCommas = this.removeTrailingCommas(next);
    if (withoutTrailingCommas !== next) {
      next = withoutTrailingCommas;
      actions.push({
        action: 'remove_trailing_commas',
        reason: 'Strip trailing commas from JSON object and array literals',
        applied: true,
      });
    }

    try {
      const parsed = JSON.parse(next);
      const jsonActions = this.repairJsonDocument(parsed, input);
      next = JSON.stringify(parsed, null, 2);
      actions.push(...jsonActions);
    } catch (error: any) {
      actions.push({
        action: 'json_object_repair_skipped',
        reason: error.message || 'Document is still not valid JSON after deterministic cleanup',
        applied: false,
      });
    }

    return {
      content: next,
      actions,
    };
  }

  private repairJsonDocument(doc: Record<string, any>, input: ApiUploadRepairInput) {
    const actions: ApiUploadRepairAction[] = [];
    const format = this.docNormalizer.detectFormat(JSON.stringify(doc), input.docType);
    const hasPaths = !!doc.paths && typeof doc.paths === 'object' && !Array.isArray(doc.paths);

    if (hasPaths && !doc.openapi && !doc.swagger) {
      doc.openapi = '3.0.0';
      actions.push({
        action: 'add_openapi_version',
        reason: 'Document has paths but misses openapi/swagger version marker',
        target: 'openapi',
        applied: true,
      });
    }

    if ((format === 'openapi' || format === 'unknown-json') && !doc.info) {
      doc.info = {
        title: input.sourceName || 'Uploaded API Document',
        version: '1.0.0',
      };
      actions.push({
        action: 'add_info_object',
        reason: 'OpenAPI document should include info metadata',
        target: 'info',
        applied: true,
      });
    }

    if (doc.host && !doc.servers) {
      const scheme = Array.isArray(doc.schemes) && doc.schemes[0] ? doc.schemes[0] : 'https';
      const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
      doc.servers = [{ url: `${scheme}://${doc.host}${basePath}` }];
      actions.push({
        action: 'swagger_host_to_servers',
        reason: 'Convert Swagger host/basePath to OpenAPI-style servers for downstream tools',
        target: 'servers',
        applied: true,
      });
    }

    if (!doc.servers && input.oaUrl) {
      doc.servers = [{ url: input.oaUrl }];
      actions.push({
        action: 'repair_servers',
        reason: 'Use OA URL as fallback server list',
        target: 'servers',
        applied: true,
      });
    }

    return actions;
  }

  private async applyLlmRepair(
    content: string,
    input: ApiUploadRepairInput,
    previousEvaluation: ApiUploadRepairEvaluation | null,
  ) {
    const actions: ApiUploadRepairAction[] = [];
    if (!this.llmClient) {
      return {
        content,
        actions: [{
          action: 'llm_repair_skipped',
          reason: 'LLM client is not configured',
          applied: false,
        }],
      };
    }

    try {
      const diagnostics = previousEvaluation?.diagnostics;
      const messages = [{
        role: 'user' as const,
        content: [
          'You repair broken OpenAPI or Swagger JSON documents.',
          'Return only valid JSON. Do not wrap with markdown.',
          'Preserve original endpoints and business meaning.',
          `Original requested docType: ${input.docType}`,
          `OA base URL: ${input.oaUrl}`,
          diagnostics ? `Diagnostics: ${JSON.stringify(diagnostics)}` : '',
          'Broken document:',
          content,
        ].filter(Boolean).join('\n\n'),
      }];
      const response = await this.llmClient.chat(messages, {
        trace: {
          scope: 'mcp.api_upload.repair',
          tenantId: input.tenantId,
          traceId: `api-upload-repair-${Date.now()}`,
          metadata: {
            connectorId: input.connectorId,
            sourceName: input.sourceName,
          },
        },
      });
      const normalized = this.stripMarkdownCodeFence(response.content || '').trim();
      JSON.parse(normalized);
      actions.push({
        action: 'llm_patch',
        reason: 'LLM proposed a structurally repaired JSON document',
        applied: true,
      });
      return {
        content: normalized,
        actions,
      };
    } catch (error: any) {
      this.logger.warn(`LLM repair failed: ${error.message}`);
      return {
        content,
        actions: [{
          action: 'llm_patch_failed',
          reason: error.message || 'LLM repair failed',
          applied: false,
        }],
      };
    }
  }

  private async evaluateCandidate(content: string, input: ApiUploadRepairInput): Promise<ApiUploadRepairEvaluation> {
    const detectedFormat = this.docNormalizer.detectFormat(content, input.docType);
    const effectiveDocType = this.toEffectiveDocType(detectedFormat, input.docType);
    const parseErrors: string[] = [];
    const schemaErrors: string[] = [];
    const refErrors: string[] = [];
    const missingFields: string[] = [];
    const suspiciousSections: string[] = [];

    try {
      const parsedDoc = JSON.parse(content);
      if (!parsedDoc.paths) {
        missingFields.push('paths');
      }
      if (!parsedDoc.info) {
        missingFields.push('info');
      }
      if (!parsedDoc.openapi && !parsedDoc.swagger) {
        missingFields.push('openapi_or_swagger_version');
      }
    } catch (error: any) {
      parseErrors.push(error.message || 'Invalid JSON');
      suspiciousSections.push('json_parse_failed');
    }

    const parseResult = await this.apiDocParser.execute(
      {
        docType: effectiveDocType,
        docContent: content,
        oaUrl: input.oaUrl,
      },
      {
        tenantId: input.tenantId,
        traceId: `api-upload-parse-${Date.now()}`,
      },
    );

    if (!parseResult.success || !parseResult.data) {
      parseErrors.push(parseResult.error || 'API document parse failed');
      const diagnostics = this.buildDiagnostics(
        detectedFormat,
        parseErrors,
        schemaErrors,
        refErrors,
        missingFields,
        suspiciousSections,
      );
      return {
        effectiveDocType,
        parseSuccess: false,
        endpointCount: 0,
        workflowCount: 0,
        validationScore: 0,
        diagnostics,
        parseError: parseErrors[parseErrors.length - 1],
      };
    }

    const endpointCount = parseResult.data.endpoints.length;
    if (endpointCount === 0) {
      schemaErrors.push('no_endpoints_extracted');
    }

    const workflowResult = await this.workflowIdentifier.execute(
      { endpoints: parseResult.data.endpoints },
      {
        tenantId: input.tenantId,
        traceId: `api-upload-identify-${Date.now()}`,
      },
    );
    const workflowCount = workflowResult.success && workflowResult.data
      ? workflowResult.data.workflowApis.length
      : 0;

    if (workflowCount === 0) {
      suspiciousSections.push('workflow_identification_empty');
    }

    const diagnostics = this.buildDiagnostics(
      detectedFormat,
      parseErrors,
      schemaErrors,
      refErrors,
      missingFields,
      suspiciousSections,
    );

    return {
      effectiveDocType,
      parseSuccess: true,
      endpointCount,
      workflowCount,
      validationScore: this.computeValidationScore(endpointCount, workflowCount),
      diagnostics,
    };
  }

  private buildDiagnostics(
    formatDetected: DocFormat,
    parseErrors: string[],
    schemaErrors: string[],
    refErrors: string[],
    missingFields: string[],
    suspiciousSections: string[],
  ): ApiUploadDiagnostics {
    const severity = parseErrors.length > 0
      ? 'high'
      : schemaErrors.length > 0 || missingFields.length > 0
        ? 'medium'
        : suspiciousSections.length > 0
          ? 'low'
          : 'low';

    return {
      formatDetected,
      parseErrors,
      schemaErrors,
      refErrors,
      missingFields,
      suspiciousSections,
      severity,
    };
  }

  private shouldAccept(evaluation: ApiUploadRepairEvaluation) {
    return evaluation.parseSuccess && evaluation.endpointCount > 0;
  }

  private shouldContinue(
    previous: ApiUploadRepairEvaluation | null,
    current: ApiUploadRepairEvaluation,
    strategy: 'deterministic' | 'llm',
    attemptNo: number,
    maxAttempts: number,
  ) {
    if (attemptNo >= maxAttempts) {
      return false;
    }

    if (strategy === 'deterministic') {
      return !current.parseSuccess || current.workflowCount === 0;
    }

    if (!previous) {
      return false;
    }

    return current.endpointCount > previous.endpointCount || current.workflowCount > previous.workflowCount;
  }

  private pickBetterEvaluation(
    previous: ApiUploadRepairEvaluation | null,
    current: ApiUploadRepairEvaluation,
  ) {
    if (!previous) {
      return current;
    }

    if (current.parseSuccess && !previous.parseSuccess) {
      return current;
    }
    if (current.workflowCount > previous.workflowCount) {
      return current;
    }
    if (current.endpointCount > previous.endpointCount) {
      return current;
    }
    if (current.validationScore > previous.validationScore) {
      return current;
    }
    return previous;
  }

  private computeValidationScore(endpointCount: number, workflowCount: number) {
    if (endpointCount <= 0) {
      return 0;
    }
    const workflowWeight = workflowCount > 0
      ? Math.min(workflowCount / endpointCount, 1)
      : 0;
    const endpointWeight = Math.min(endpointCount / 20, 1);
    return Number((endpointWeight * 0.6 + workflowWeight * 0.4).toFixed(4));
  }

  private toEffectiveDocType(
    format: DocFormat,
    requested: ApiUploadRepairInput['docType'],
  ): 'openapi' | 'swagger' | 'postman' | 'custom' {
    if (format === 'swagger') {
      return 'swagger';
    }
    if (format === 'postman') {
      return 'postman';
    }
    if (format === 'openapi' || format === 'unknown-json') {
      return 'openapi';
    }
    return requested;
  }

  private removeTrailingCommas(content: string) {
    let current = content;
    let previous = '';
    while (current !== previous) {
      previous = current;
      current = current.replace(/,\s*([}\]])/g, '$1');
    }
    return current;
  }

  private stripMarkdownCodeFence(content: string) {
    if (!content.startsWith('```')) {
      return content;
    }
    return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  private isLlmConfigured() {
    const provider = process.env.LLM_PROVIDER || 'openai';
    if (provider === 'ollama') {
      return true;
    }
    return Boolean(
      process.env.LLM_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.ANTHROPIC_API_KEY,
    );
  }
}
