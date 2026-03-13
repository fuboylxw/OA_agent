import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory } from '@uniflow/agent-kernel';
import { z } from 'zod';

const ApiDocParserInputSchema = z.object({
  docType: z.enum(['openapi', 'swagger', 'postman', 'custom']),
  docContent: z.string(),
  oaUrl: z.string().url(),
});

const ApiDocParserOutputSchema = z.object({
  authType: z.string(),
  baseUrl: z.string(),
  endpoints: z.array(
    z.object({
      path: z.string(),
      method: z.string(),
      description: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean(),
          description: z.string().optional(),
        }),
      ),
      requestBody: z.any().optional(),
      responses: z.any().optional(),
    }),
  ),
});

type ApiDocParserInput = z.infer<typeof ApiDocParserInputSchema>;
type ApiDocParserOutput = z.infer<typeof ApiDocParserOutputSchema>;

@Injectable()
export class ApiDocParserAgent extends BaseAgent<
  ApiDocParserInput,
  ApiDocParserOutput
> {
  private readonly logger = new Logger(ApiDocParserAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();

  constructor() {
    const config: AgentConfig = {
      name: 'api-doc-parser',
      description: 'Parse API documentation and extract endpoint information',
      inputSchema: ApiDocParserInputSchema,
      outputSchema: ApiDocParserOutputSchema,
    };
    super(config);
  }

  protected async run(
    input: ApiDocParserInput,
    context: AgentContext,
  ): Promise<ApiDocParserOutput> {
    this.logger.log(`Parsing ${input.docType} documentation`);

    if (input.docType === 'openapi' || input.docType === 'swagger') {
      return this.parseOpenAPI(input.docContent, input.oaUrl);
    } else if (input.docType === 'custom') {
      return this.parseWithLLM(input.docContent, input.oaUrl, context);
    }

    throw new Error(`Unsupported doc type: ${input.docType}`);
  }

  /**
   * Parse OpenAPI/Swagger documentation
   */
  private parseOpenAPI(
    docContent: string,
    oaUrl: string,
  ): ApiDocParserOutput {
    try {
      const doc = JSON.parse(docContent);

      const baseUrl = doc.servers?.[0]?.url || oaUrl;
      const authType = this.detectAuthType(doc);
      const endpoints: any[] = [];

      // Parse paths
      for (const [path, pathItem] of Object.entries(doc.paths || {})) {
        for (const [method, operation] of Object.entries(pathItem as any)) {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            const op = operation as any;

            endpoints.push({
              path,
              method: method.toUpperCase(),
              description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
              parameters: this.parseParameters(op.parameters || []),
              requestBody: op.requestBody?.content?.['application/json']?.schema,
              responses: op.responses,
            });
          }
        }
      }

      this.logger.log(`Parsed ${endpoints.length} endpoints from OpenAPI`);

      return {
        authType,
        baseUrl,
        endpoints,
      };
    } catch (error: any) {
      this.logger.error(`Failed to parse OpenAPI: ${error.message}`);
      throw new Error(`Failed to parse OpenAPI documentation: ${error.message}`);
    }
  }

  /**
   * Parse with LLM for custom documentation
   */
  private async parseWithLLM(
    docContent: string,
    oaUrl: string,
    context?: AgentContext,
  ): Promise<ApiDocParserOutput> {
    const prompt = `
你是一个 API 文档解析专家。请分析以下 OA 系统的 API 文档，提取所有可用的 API 端点。

OA 系统地址：${oaUrl}

文档内容：
${docContent}

请提取以下信息并以 JSON 格式返回：
{
  "authType": "认证方式（oauth2/apikey/basic/cookie）",
  "baseUrl": "API 基础 URL",
  "endpoints": [
    {
      "path": "API 路径",
      "method": "HTTP 方法（GET/POST/PUT/DELETE）",
      "description": "端点描述",
      "parameters": [
        {
          "name": "参数名",
          "type": "参数类型（string/number/boolean）",
          "required": true/false,
          "description": "参数描述"
        }
      ],
      "requestBody": {},
      "responses": {}
    }
  ]
}

只返回 JSON，不要其他内容。
`;

    try {
      const messages = [
        { role: 'user' as const, content: prompt }
      ];
      const response = await this.llmClient.chat(messages, {
        trace: {
          scope: 'mcp.api_doc_parser.parse',
          traceId: context?.traceId,
          tenantId: context?.tenantId,
          userId: context?.userId,
          metadata: {
            oaUrl,
          },
        },
      });
      const llmResult = response.content;

      // Remove markdown code blocks if present
      let jsonStr = llmResult.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      this.logger.log(`Parsed ${parsed.endpoints.length} endpoints with LLM`);

      return parsed;
    } catch (error: any) {
      this.logger.error(`LLM parsing failed: ${error.message}`);
      throw new Error(`Failed to parse documentation with LLM: ${error.message}`);
    }
  }

  /**
   * Detect authentication type from OpenAPI doc
   */
  private detectAuthType(doc: any): string {
    const securitySchemes = doc.components?.securitySchemes || {};

    for (const [name, scheme] of Object.entries(securitySchemes)) {
      const s = scheme as any;
      if (s.type === 'oauth2') return 'oauth2';
      if (s.type === 'apiKey') return 'apikey';
      if (s.type === 'http' && s.scheme === 'basic') return 'basic';
    }

    return 'apikey'; // default
  }

  /**
   * Parse OpenAPI parameters
   */
  private parseParameters(params: any[]): any[] {
    return params.map(p => ({
      name: p.name,
      type: p.schema?.type || 'string',
      required: p.required || false,
      description: p.description || '',
    }));
  }
}
