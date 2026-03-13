import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, BaseLLMClient } from '@uniflow/agent-kernel';
import {
  DocFormat,
  NormalizedEndpoint,
  NormalizedParam,
  NormalizeResult,
} from './types';

@Injectable()
export class DocNormalizerService {
  private readonly logger = new Logger(DocNormalizerService.name);
  private llmClient: BaseLLMClient;

  constructor() {
    this.llmClient = LLMClientFactory.createFromEnv();
  }

  /**
   * 主入口：自动检测格式 + 标准化
   */
  async normalize(content: string, formatHint?: string): Promise<NormalizeResult> {
    const format = this.detectFormat(content, formatHint);
    this.logger.log(`Detected format: ${format}`);

    switch (format) {
      case 'openapi':
        return this.normalizeOpenApi(JSON.parse(content));
      case 'swagger':
        return this.normalizeSwagger(JSON.parse(content));
      case 'postman':
        return this.normalizePostman(JSON.parse(content));
      case 'har':
        return this.normalizeHar(JSON.parse(content));
      case 'unknown-json':
        return this.normalizeUnknownJson(content);
      case 'unknown-text':
        return this.normalizeWithLLM(content);
      default:
        return this.normalizeWithLLM(content);
    }
  }

  /**
   * 自动检测文档格式
   */
  detectFormat(content: string, hint?: string): DocFormat {
    const trimmed = content.trim();

    // 尝试 YAML → JSON 转换（简单判断）
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      if (trimmed.includes('openapi:') || trimmed.includes('openapi :')) return 'openapi';
      if (trimmed.includes('swagger:') || trimmed.includes('swagger :')) return 'swagger';
      return 'unknown-text';
    }

    try {
      const doc = JSON.parse(trimmed);

      if (doc.openapi && typeof doc.openapi === 'string' && doc.openapi.startsWith('3')) {
        return 'openapi';
      }
      if (doc.swagger && typeof doc.swagger === 'string') {
        return 'swagger';
      }
      if (doc.info && (doc.item || doc.collection)) {
        return 'postman';
      }
      if (doc.log && doc.log.entries) {
        return 'har';
      }
      // 有 paths 字段但没有 openapi/swagger 标记，仍然当 openapi 处理
      if (doc.paths && typeof doc.paths === 'object') {
        return 'openapi';
      }
      return 'unknown-json';
    } catch {
      return 'unknown-text';
    }
  }

  // ── OpenAPI 3.x ──────────────────────────────────────────────

  private normalizeOpenApi(doc: any): NormalizeResult {
    const endpoints: NormalizedEndpoint[] = [];
    const baseUrl = doc.servers?.[0]?.url || '';
    const authHint = this.detectAuthFromOpenApi(doc);

    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const op = operation as any;

        const parameters = this.parseOpenApiParams(op.parameters || []);
        const requestBody = this.parseOpenApiRequestBody(op.requestBody, doc);
        const responseSchema = this.parseOpenApiResponse(op.responses, doc);

        endpoints.push({
          path,
          method: method.toUpperCase(),
          summary: op.summary || op.description || `${method.toUpperCase()} ${path}`,
          tags: op.tags || [],
          parameters,
          requestBody,
          responseSchema,
        });
      }
    }

    this.logger.log(`OpenAPI: parsed ${endpoints.length} endpoints`);
    return {
      format: 'openapi',
      baseUrl,
      authHint,
      endpoints,
      rawEndpointCount: endpoints.length,
    };
  }

  private parseOpenApiParams(params: any[]): NormalizedParam[] {
    return params.map(p => ({
      name: p.name,
      in: p.in || 'query',
      type: p.schema?.type || 'string',
      required: p.required || false,
      description: p.description || '',
      enum: p.schema?.enum,
      default: p.schema?.default,
    }));
  }

  private parseOpenApiRequestBody(
    requestBody: any,
    doc: any,
  ): NormalizedEndpoint['requestBody'] | undefined {
    if (!requestBody) return undefined;

    const content = requestBody.content;
    if (!content) return undefined;

    const jsonContent = content['application/json'] || content['application/x-www-form-urlencoded'];
    if (!jsonContent?.schema) return undefined;

    const schema = this.resolveRef(jsonContent.schema, doc);
    return {
      contentType: content['application/json'] ? 'application/json' : 'application/x-www-form-urlencoded',
      schema,
    };
  }

  private parseOpenApiResponse(
    responses: any,
    doc: any,
  ): Record<string, any> | undefined {
    if (!responses) return undefined;
    const ok = responses['200'] || responses['201'];
    if (!ok?.content?.['application/json']?.schema) return undefined;
    return this.resolveRef(ok.content['application/json'].schema, doc);
  }

  /**
   * 递归解析 $ref 引用
   */
  private resolveRef(schema: any, doc: any, depth = 0): any {
    if (!schema || depth > 10) return schema;

    if (schema.$ref) {
      const refPath = schema.$ref.replace('#/', '').split('/');
      let resolved: any = doc;
      for (const segment of refPath) {
        resolved = resolved?.[segment];
      }
      if (!resolved) return schema;
      return this.resolveRef(resolved, doc, depth + 1);
    }

    // 递归处理 properties
    if (schema.properties) {
      const resolved = { ...schema, properties: {} };
      for (const [key, value] of Object.entries(schema.properties)) {
        resolved.properties[key] = this.resolveRef(value, doc, depth + 1);
      }
      return resolved;
    }

    // 递归处理 items (array)
    if (schema.items) {
      return { ...schema, items: this.resolveRef(schema.items, doc, depth + 1) };
    }

    // allOf / oneOf / anyOf
    for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
      if (schema[combiner]) {
        const resolved = schema[combiner].map((s: any) => this.resolveRef(s, doc, depth + 1));
        if (combiner === 'allOf') {
          // 合并 allOf 为单个 schema
          return this.mergeAllOf(resolved);
        }
        return { ...schema, [combiner]: resolved };
      }
    }

    return schema;
  }

  private mergeAllOf(schemas: any[]): any {
    const merged: any = { type: 'object', properties: {}, required: [] };
    for (const s of schemas) {
      if (s.properties) Object.assign(merged.properties, s.properties);
      if (s.required) merged.required.push(...s.required);
    }
    if (merged.required.length === 0) delete merged.required;
    if (Object.keys(merged.properties).length === 0) delete merged.properties;
    return merged;
  }

  private detectAuthFromOpenApi(doc: any): NormalizeResult['authHint'] {
    const schemes = doc.components?.securitySchemes || {};
    for (const [, scheme] of Object.entries(schemes)) {
      const s = scheme as any;
      if (s.type === 'oauth2') return { type: 'oauth2' };
      if (s.type === 'apiKey') return { type: 'apikey', headerName: s.name };
      if (s.type === 'http' && s.scheme === 'basic') return { type: 'basic' };
      if (s.type === 'http' && s.scheme === 'bearer') return { type: 'bearer' };
    }
    return undefined;
  }

  // ── Swagger 2.x ──────────────────────────────────────────────

  private normalizeSwagger(doc: any): NormalizeResult {
    const endpoints: NormalizedEndpoint[] = [];
    const baseUrl = doc.host
      ? `${doc.schemes?.[0] || 'https'}://${doc.host}${doc.basePath || ''}`
      : doc.basePath || '';

    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const op = operation as any;

        const parameters: NormalizedParam[] = [];
        let requestBody: NormalizedEndpoint['requestBody'] | undefined;

        for (const p of op.parameters || []) {
          if (p.in === 'body') {
            const schema = this.resolveSwaggerRef(p.schema, doc);
            requestBody = { contentType: 'application/json', schema };
          } else {
            parameters.push({
              name: p.name,
              in: p.in,
              type: p.type || 'string',
              required: p.required || false,
              description: p.description || '',
              enum: p.enum,
              default: p.default,
            });
          }
        }

        endpoints.push({
          path,
          method: method.toUpperCase(),
          summary: op.summary || op.description || `${method.toUpperCase()} ${path}`,
          tags: op.tags || [],
          parameters,
          requestBody,
        });
      }
    }

    this.logger.log(`Swagger: parsed ${endpoints.length} endpoints`);
    return {
      format: 'swagger',
      baseUrl,
      endpoints,
      rawEndpointCount: endpoints.length,
    };
  }

  private resolveSwaggerRef(schema: any, doc: any, depth = 0): any {
    if (!schema || depth > 10) return schema;
    if (schema.$ref) {
      const refPath = schema.$ref.replace('#/', '').split('/');
      let resolved: any = doc;
      for (const segment of refPath) resolved = resolved?.[segment];
      return resolved ? this.resolveSwaggerRef(resolved, doc, depth + 1) : schema;
    }
    if (schema.properties) {
      const resolved = { ...schema, properties: {} };
      for (const [key, value] of Object.entries(schema.properties)) {
        resolved.properties[key] = this.resolveSwaggerRef(value, doc, depth + 1);
      }
      return resolved;
    }
    if (schema.items) {
      return { ...schema, items: this.resolveSwaggerRef(schema.items, doc, depth + 1) };
    }
    return schema;
  }

  // ── Postman Collection ───────────────────────────────────────

  private normalizePostman(collection: any): NormalizeResult {
    const endpoints: NormalizedEndpoint[] = [];
    this.extractPostmanItems(collection.item || [], endpoints);

    this.logger.log(`Postman: parsed ${endpoints.length} endpoints`);
    return {
      format: 'postman',
      endpoints,
      rawEndpointCount: endpoints.length,
    };
  }

  private extractPostmanItems(items: any[], endpoints: NormalizedEndpoint[]) {
    for (const item of items) {
      if (item.item) {
        // Folder — recurse
        this.extractPostmanItems(item.item, endpoints);
        continue;
      }

      const request = item.request;
      if (!request) continue;

      const url = typeof request.url === 'string'
        ? request.url
        : request.url?.raw || '';

      let path: string;
      try {
        path = new URL(url, 'http://placeholder').pathname;
      } catch {
        path = url;
      }

      const method = (request.method || 'GET').toUpperCase();
      const parameters: NormalizedParam[] = [];

      // Query params
      const queryParams = typeof request.url === 'object' ? request.url.query || [] : [];
      for (const q of queryParams) {
        parameters.push({
          name: q.key,
          in: 'query',
          type: 'string',
          required: false,
          description: q.description || '',
        });
      }

      let requestBody: NormalizedEndpoint['requestBody'] | undefined;
      if (request.body?.mode === 'raw' && request.body.raw) {
        try {
          const schema = JSON.parse(request.body.raw);
          requestBody = { contentType: 'application/json', schema };
        } catch {
          // not JSON body
        }
      }

      endpoints.push({
        path,
        method,
        summary: item.name || `${method} ${path}`,
        tags: [],
        parameters,
        requestBody,
      });
    }
  }

  // ── HAR ──────────────────────────────────────────────────────

  private normalizeHar(har: any): NormalizeResult {
    const entries = har.log?.entries || [];
    const seen = new Set<string>();
    const endpoints: NormalizedEndpoint[] = [];

    for (const entry of entries) {
      const req = entry.request;
      if (!req) continue;

      let path: string;
      try {
        const url = new URL(req.url);
        path = url.pathname;
      } catch {
        continue;
      }

      const method = (req.method || 'GET').toUpperCase();
      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const parameters: NormalizedParam[] = [];
      try {
        const url = new URL(req.url);
        url.searchParams.forEach((value, name) => {
          parameters.push({
            name,
            in: 'query',
            type: 'string',
            required: false,
            description: '',
          });
        });
      } catch {
        // ignore
      }

      let requestBody: NormalizedEndpoint['requestBody'] | undefined;
      if (req.postData?.text) {
        try {
          const schema = JSON.parse(req.postData.text);
          requestBody = {
            contentType: req.postData.mimeType || 'application/json',
            schema,
          };
        } catch {
          // not JSON
        }
      }

      endpoints.push({
        path,
        method,
        summary: `${method} ${path}`,
        tags: [],
        parameters,
        requestBody,
      });
    }

    this.logger.log(`HAR: parsed ${endpoints.length} unique endpoints`);
    return {
      format: 'har',
      endpoints,
      rawEndpointCount: entries.length,
    };
  }

  // ── Unknown JSON (非标准格式) ──────────────────────────────

  private async normalizeUnknownJson(content: string): Promise<NormalizeResult> {
    // 非标准 JSON 格式，统一走 LLM 兜底分析
    return this.normalizeWithLLM(content);
  }

  // ── LLM 兜底 ────────────────────────────────────────────────

  private async normalizeWithLLM(content: string): Promise<NormalizeResult> {
    // 截断过长内容
    const maxLen = 40000;
    const truncated = content.length > maxLen
      ? content.substring(0, maxLen) + '\n... (truncated)'
      : content;

    const prompt = `你是一个 API 文档解析专家。请从以下内容中提取所有 API 端点信息。

文档内容：
${truncated}

请返回 JSON 格式：
{
  "baseUrl": "API 基础 URL（如果能推断）",
  "authType": "认证方式（apikey/oauth2/basic/cookie，如果能推断）",
  "endpoints": [
    {
      "path": "/api/xxx",
      "method": "GET",
      "summary": "端点描述",
      "tags": [],
      "parameters": [
        { "name": "参数名", "in": "query", "type": "string", "required": false, "description": "" }
      ]
    }
  ]
}

只返回 JSON，不要其他内容。如果无法提取任何端点，返回 { "endpoints": [] }。`;

    try {
      const response = await this.llmClient.chat([
        { role: 'user', content: prompt },
      ], {
        trace: {
          scope: 'api_parse.doc_normalizer.normalize',
          metadata: {
            format: 'unknown-text',
          },
        },
      });

      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);
      const endpoints: NormalizedEndpoint[] = (parsed.endpoints || []).map((ep: any) => ({
        path: ep.path || '',
        method: (ep.method || 'GET').toUpperCase(),
        summary: ep.summary || ep.description || '',
        tags: ep.tags || [],
        parameters: (ep.parameters || []).map((p: any) => ({
          name: p.name || '',
          in: p.in || 'query',
          type: p.type || 'string',
          required: p.required || false,
          description: p.description || '',
        })),
        requestBody: ep.requestBody,
      }));

      this.logger.log(`LLM fallback: parsed ${endpoints.length} endpoints`);
      return {
        format: 'unknown-json',
        baseUrl: parsed.baseUrl,
        authHint: parsed.authType ? { type: parsed.authType } : undefined,
        endpoints,
        rawEndpointCount: endpoints.length,
      };
    } catch (error: any) {
      this.logger.error(`LLM normalization failed: ${error.message}`);
      return {
        format: 'unknown-text',
        endpoints: [],
        rawEndpointCount: 0,
      };
    }
  }
}
