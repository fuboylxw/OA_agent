import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface ParseDocumentOptions {
  autoPublish?: boolean;
  extractBusinessLogic?: boolean;
  generateFieldMapping?: boolean;
  confidenceThreshold?: number;
  filterNonBusinessEndpoints?: boolean; // 是否过滤非业务流程接口
  includeUserLinks?: boolean; // 是否解析用户接口链接内容
}

export interface ParsedProcess {
  processCode: string;
  processName: string;
  processCategory: string;
  description?: string;
  confidence: number;
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
  }>;
  fields: Array<{
    fieldCode: string;
    fieldName: string;
    fieldType: string;
    required: boolean;
    confidence: number;
    options?: string[];
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  }>;
}

export interface ParseResult {
  processes: ParsedProcess[];
  fieldMapping?: Record<string, any>;
  filteredEndpoints?: string[]; // 被过滤掉的非业务接口
  warnings: Array<{
    endpoint?: string;
    message: string;
    confidence?: number;
  }>;
  metadata: {
    parseTime: number;
    llmModel: string;
    llmTokens: number;
    totalEndpoints: number;
    businessEndpoints: number;
    filteredEndpoints: number;
  };
}

@Injectable()
export class ApiDocumentParserAgent {
  private readonly logger = new Logger(ApiDocumentParserAgent.name);
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async parseDocument(
    documentContent: string,
    documentType: string,
    options: ParseDocumentOptions = {},
  ): Promise<ParseResult> {
    const startTime = Date.now();
    this.logger.log(`开始解析${documentType}文档`);

    try {
      // 1. 预处理文档
      const preprocessed = this.preprocessDocument(documentContent, documentType);

      // 2. 过滤非业务流程接口（如果启用）
      let filteredDoc = preprocessed;
      let filteredEndpoints: string[] = [];
      let totalEndpoints = 0;
      let businessEndpoints = 0;

      if (options.filterNonBusinessEndpoints) {
        const filterResult = await this.filterNonBusinessEndpoints(preprocessed, documentType);
        filteredDoc = filterResult.filteredDocument;
        filteredEndpoints = filterResult.filteredEndpoints;
        totalEndpoints = filterResult.totalEndpoints;
        businessEndpoints = filterResult.businessEndpoints;

        this.logger.log(`过滤完成: 总接口${totalEndpoints}个，业务接口${businessEndpoints}个，过滤${filteredEndpoints.length}个`);
      }

      // 3. 解析用户接口链接内容（如果启用）
      if (options.includeUserLinks) {
        filteredDoc = await this.enrichWithUserLinks(filteredDoc, documentType);
      }

      // 4. 构建提示词
      const prompt = this.buildPrompt(filteredDoc, documentType, options);

      // 5. 调用LLM
      const response = await this.callLLM(prompt);

      // 6. 提取和验证结果
      const rawResult = this.extractJsonFromResponse(response);
      const validatedResult = this.validateAndEnrich(rawResult, options);

      // 7. 生成元数据
      const parseTime = Date.now() - startTime;
      const metadata = {
        parseTime,
        llmModel: 'claude-opus-4-6',
        llmTokens: response.usage.input_tokens + response.usage.output_tokens,
        totalEndpoints: totalEndpoints || this.countEndpointsInDoc(preprocessed),
        businessEndpoints: businessEndpoints || validatedResult.processes.reduce((sum, p) => sum + p.endpoints.length, 0),
        filteredEndpoints: filteredEndpoints.length,
      };

      this.logger.log(`解析完成，耗时${parseTime}ms，提取${validatedResult.processes.length}个流程`);

      return {
        ...validatedResult,
        filteredEndpoints: filteredEndpoints.length > 0 ? filteredEndpoints : undefined,
        metadata,
      };
    } catch (error) {
      this.logger.error(`解析失败: ${error.message}`, error.stack);
      throw error;
    }
  }

  private preprocessDocument(content: string, type: string): string {
    // 移除注释和无关信息
    let processed = content;

    if (type === 'openapi' || type === 'swagger') {
      try {
        const doc = JSON.parse(content);
        // 只保留关键信息
        const simplified = {
          openapi: doc.openapi || doc.swagger,
          info: doc.info,
          servers: doc.servers,
          paths: doc.paths,
          components: doc.components?.schemas,
        };
        processed = JSON.stringify(simplified, null, 2);
      } catch (e) {
        this.logger.warn('文档预处理失败，使用原始内容');
      }
    }

    // 限制长度
    const maxLength = 50000;
    if (processed.length > maxLength) {
      this.logger.warn(`文档过长(${processed.length}字符)，截断至${maxLength}字符`);
      processed = processed.substring(0, maxLength);
    }

    return processed;
  }

  private buildPrompt(
    documentContent: string,
    documentType: string,
    options: ParseDocumentOptions,
  ): string {
    const systemPrompt = `你是一个专业的API文档解析专家，负责从API文档中提取OA办公流程信息。

## 任务目标
分析提供的API文档，识别其中的办公流程（如请假、报销、采购等），并提取以下信息：

1. **流程识别**
   - processCode：使用大写下划线命名，如 LEAVE_REQUEST
   - processName：中文名称
   - processCategory：人事/财务/行政/采购/综合等
   - description：流程描述

2. **端点映射**
   - 提交端点：POST /xxx/submit 或 POST /xxx/create
   - 查询端点：GET /xxx/{id} 或 GET /xxx/detail
   - 操作端点：POST /xxx/{id}/cancel、POST /xxx/{id}/approve 等

3. **字段提取**
   - fieldCode：小写下划线命名
   - fieldName：中文名称
   - fieldType：text/number/date/datetime/select/multiselect/textarea/file/boolean
   - required：是否必填
   - 字段约束：maxLength/min/max/pattern/options等
   - 如果字段有 x-options-data，使用其中的数据作为选项列表

4. **置信度评估**
   - 为每个提取的信息标注置信度（0-1）
   - 如果信息不明确，标注为低置信度并在warnings中说明

## 输出格式
返回JSON格式，结构如下：
{
  "processes": [
    {
      "processCode": "LEAVE_REQUEST",
      "processName": "请假申请",
      "processCategory": "人事",
      "description": "教职工请假申请流程",
      "confidence": 0.92,
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/v1/leave/submit",
          "description": "提交请假申请"
        }
      ],
      "fields": [
        {
          "fieldCode": "leave_type",
          "fieldName": "请假类型",
          "fieldType": "select",
          "required": true,
          "options": ["事假", "病假", "年假"],
          "confidence": 0.95
        }
      ]
    }
  ],
  "warnings": [
    {
      "endpoint": "/api/v1/xxx",
      "message": "字段类型推断置信度较低",
      "confidence": 0.65
    }
  ]
}

## 注意事项
- 优先识别高频办公流程（请假、报销、采购、出差、用印、会议室预订等）
- 字段类型推断要准确：日期用date，金额用number，长文本用textarea
- 如果API文档信息不完整，在warnings中说明
- 保持字段命名的一致性和规范性
- 如果某个端点不属于办公流程，可以忽略
- 注意提取字段的 x-options-data 作为选项列表`;

    const userPrompt = `
## API文档类型
${documentType}

## API文档内容
\`\`\`json
${documentContent}
\`\`\`

${options.extractBusinessLogic ? '\n请特别注意提取业务逻辑和流程关系。' : ''}
${options.generateFieldMapping ? '\n请生成字段映射关系。' : ''}
${options.filterNonBusinessEndpoints ? '\n注意：文档已经过滤了非业务接口，只包含业务申请相关的接口。' : ''}
${options.includeUserLinks ? '\n注意：部分字段包含 x-options-data，请使用这些数据作为选项列表。' : ''}

请开始解析，返回JSON格式的结果。`;

    return `${systemPrompt}\n\n${userPrompt}`;
  }

  private async callLLM(prompt: string) {
    const response = await this.anthropic.messages.create({
      model: process.env.LLM_MODEL || 'claude-opus-4-6',
      max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '16000'),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.2'),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return response;
  }

  private extractJsonFromResponse(response: any): any {
    const content = response.content[0].text;

    // 尝试提取JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('无法从LLM响应中提取JSON');
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      this.logger.error('JSON解析失败', content);
      throw new Error('LLM返回的JSON格式错误');
    }
  }

  private validateAndEnrich(
    result: any,
    options: ParseDocumentOptions,
  ): Omit<ParseResult, 'metadata'> {
    // 验证必填字段
    if (!result.processes || !Array.isArray(result.processes)) {
      throw new Error('解析结果缺少processes字段');
    }

    const warnings = result.warnings || [];
    const confidenceThreshold = options.confidenceThreshold || 0.8;

    // 处理每个流程
    result.processes.forEach((process: ParsedProcess) => {
      // 验证必填字段
      if (!process.processCode || !process.processName) {
        throw new Error('流程缺少必填字段: processCode或processName');
      }

      // 标准化processCode
      process.processCode = process.processCode.toUpperCase();

      // 验证和修正字段类型
      process.fields?.forEach((field: any) => {
        if (!this.isValidFieldType(field.fieldType)) {
          warnings.push({
            message: `字段${field.fieldCode}的类型${field.fieldType}不合法，已修正为text`,
            confidence: field.confidence,
          });
          field.fieldType = 'text';
          field.confidence = Math.min(field.confidence || 0.5, 0.6);
        }

        // 检查置信度
        if (field.confidence < confidenceThreshold) {
          warnings.push({
            message: `字段${field.fieldCode}的置信度(${field.confidence})低于阈值(${confidenceThreshold})`,
            confidence: field.confidence,
          });
        }
      });

      // 检查流程置信度
      if (process.confidence < confidenceThreshold) {
        warnings.push({
          message: `流程${process.processCode}的置信度(${process.confidence})低于阈值(${confidenceThreshold})`,
          confidence: process.confidence,
        });
      }
    });

    return {
      processes: result.processes,
      fieldMapping: result.fieldMapping,
      warnings,
    };
  }

  private isValidFieldType(type: string): boolean {
    const validTypes = [
      'text',
      'number',
      'date',
      'datetime',
      'select',
      'multiselect',
      'textarea',
      'file',
      'boolean',
    ];
    return validTypes.includes(type);
  }

  /**
   * 过滤非业务流程接口
   * 使用LLM识别哪些接口是业务申请相关的，过滤掉系统管理、配置、监控等接口
   */
  private async filterNonBusinessEndpoints(
    documentContent: string,
    documentType: string,
  ): Promise<{
    filteredDocument: string;
    filteredEndpoints: string[];
    totalEndpoints: number;
    businessEndpoints: number;
  }> {
    this.logger.log('开始过滤非业务流程接口');

    try {
      const doc = JSON.parse(documentContent);
      const paths = doc.paths || {};
      const allEndpoints = Object.keys(paths);
      const totalEndpoints = allEndpoints.length;

      if (totalEndpoints === 0) {
        return {
          filteredDocument: documentContent,
          filteredEndpoints: [],
          totalEndpoints: 0,
          businessEndpoints: 0,
        };
      }

      // 构建过滤提示词
      const filterPrompt = this.buildFilterPrompt(allEndpoints, paths);

      // 调用LLM进行分类
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 8000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: filterPrompt,
          },
        ],
      });

      const filterResult = this.extractJsonFromResponse(response);

      // 提取业务接口列表
      const businessEndpoints = filterResult.businessEndpoints || [];
      const filteredEndpoints = allEndpoints.filter(
        (ep) => !businessEndpoints.includes(ep),
      );

      // 构建过滤后的文档
      const filteredPaths: any = {};
      businessEndpoints.forEach((endpoint: string) => {
        if (paths[endpoint]) {
          filteredPaths[endpoint] = paths[endpoint];
        }
      });

      const filteredDoc = {
        ...doc,
        paths: filteredPaths,
      };

      this.logger.log(
        `过滤完成: 保留${businessEndpoints.length}个业务接口，过滤${filteredEndpoints.length}个非业务接口`,
      );

      return {
        filteredDocument: JSON.stringify(filteredDoc, null, 2),
        filteredEndpoints,
        totalEndpoints,
        businessEndpoints: businessEndpoints.length,
      };
    } catch (error) {
      this.logger.error(`过滤接口失败: ${error.message}`, error.stack);
      // 如果过滤失败，返回原始文档
      return {
        filteredDocument: documentContent,
        filteredEndpoints: [],
        totalEndpoints: 0,
        businessEndpoints: 0,
      };
    }
  }

  /**
   * 构建接口过滤提示词
   */
  private buildFilterPrompt(endpoints: string[], paths: any): string {
    // 提取端点的简要信息
    const endpointSummaries = endpoints.map((endpoint) => {
      const methods = Object.keys(paths[endpoint]);
      const descriptions = methods.map((method) => {
        const operation = paths[endpoint][method];
        return operation.summary || operation.description || '';
      });

      return {
        path: endpoint,
        methods,
        description: descriptions.join('; '),
      };
    });

    return `你是一个API接口分类专家，负责识别哪些接口是OA办公业务申请相关的。

## 任务目标
从以下API接口列表中，识别出**业务申请相关的接口**，过滤掉非业务接口。

## 业务申请接口特征
业务申请接口通常包括：
- 请假申请、报销申请、采购申请、出差申请、用印申请等
- 会议室预订、车辆申请、物资领用等
- 流程提交、查询、撤回、催办等操作
- 表单填写、审批相关的接口

## 非业务接口特征（需要过滤）
以下类型的接口应该被过滤：
- 系统管理接口（用户管理、角色管理、权限配置）
- 系统配置接口（参数设置、字典管理）
- 监控接口（健康检查、指标统计、日志查询）
- 认证接口（登录、登出、token刷新）
- 文件上传下载接口（通用文件服务）
- 通知消息接口（消息推送、通知列表）
- 组织架构接口（部门查询、人员查询）
- 纯查询类接口（如果不是查询申请状态）

## API接口列表
\`\`\`json
${JSON.stringify(endpointSummaries, null, 2)}
\`\`\`

## 输出格式
返回JSON格式，只包含业务申请相关的接口路径：
{
  "businessEndpoints": [
    "/api/v1/leave/submit",
    "/api/v1/expense/create",
    "/api/v1/leave/{id}",
    "/api/v1/expense/{id}/cancel"
  ],
  "reasoning": "简要说明分类依据"
}

请开始分类，只返回JSON格式的结果。`;
  }

  /**
   * 解析用户接口链接内容
   * 支持从接口响应中提取额外的业务信息（如选项列表、字段约束等）
   */
  private async enrichWithUserLinks(
    documentContent: string,
    documentType: string,
  ): Promise<string> {
    this.logger.log('开始解析用户接口链接内容');

    try {
      const doc = JSON.parse(documentContent);
      const paths = doc.paths || {};

      // 识别包含链接引用的字段
      const linksToFetch: Array<{
        endpoint: string;
        field: string;
        linkUrl: string;
      }> = [];

      for (const [endpoint, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods as any)) {
          const operationObj = operation as any;
          const requestBody = operationObj.requestBody?.content?.['application/json']?.schema;
          if (requestBody?.properties) {
            for (const [fieldName, fieldSchema] of Object.entries(
              requestBody.properties,
            )) {
              const schema = fieldSchema as any;
              // 检查是否有链接引用（如 x-options-url, x-data-source等）
              if (schema['x-options-url'] || schema['x-data-source']) {
                linksToFetch.push({
                  endpoint,
                  field: fieldName,
                  linkUrl: schema['x-options-url'] || schema['x-data-source'],
                });
              }
            }
          }
        }
      }

      if (linksToFetch.length === 0) {
        this.logger.log('未发现需要解析的用户接口链接');
        return documentContent;
      }

      this.logger.log(`发现${linksToFetch.length}个用户接口链接，开始获取内容`);

      // 获取链接内容并丰富文档
      for (const link of linksToFetch) {
        try {
          const linkContent = await this.fetchLinkContent(link.linkUrl);

          // 将链接内容添加到字段定义中
          const methods = paths[link.endpoint];
          for (const [method, operation] of Object.entries(methods as any)) {
            const operationObj = operation as any;
            const requestBody = operationObj.requestBody?.content?.['application/json']?.schema;
            if (requestBody?.properties?.[link.field]) {
              requestBody.properties[link.field]['x-options-data'] = linkContent;
              this.logger.log(`成功获取 ${link.endpoint}.${link.field} 的选项数据`);
            }
          }
        } catch (error) {
          this.logger.warn(
            `获取链接内容失败: ${link.linkUrl}, 错误: ${error.message}`,
          );
        }
      }

      return JSON.stringify(doc, null, 2);
    } catch (error) {
      this.logger.error(`解析用户接口链接失败: ${error.message}`, error.stack);
      return documentContent;
    }
  }

  /**
   * 获取链接内容
   */
  private async fetchLinkContent(url: string): Promise<any> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5秒超时
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw new Error(`获取链接内容失败: ${error.message}`);
    }
  }

  /**
   * 统计文档中的端点数量
   */
  private countEndpointsInDoc(documentContent: string): number {
    try {
      const doc = JSON.parse(documentContent);
      return Object.keys(doc.paths || {}).length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 批量解析多个端点（用于大文档分片处理）
   */
  async parseEndpointsBatch(
    endpoints: any[],
    documentType: string,
    options: ParseDocumentOptions = {},
  ): Promise<ParseResult> {
    const batchSize = 20;
    const batches: any[][] = [];

    for (let i = 0; i < endpoints.length; i += batchSize) {
      batches.push(endpoints.slice(i, i + batchSize));
    }

    this.logger.log(`分${batches.length}批处理${endpoints.length}个端点`);

    const results: ParseResult[] = [];
    for (const batch of batches) {
      const batchDoc = JSON.stringify({ paths: batch });
      const result = await this.parseDocument(batchDoc, documentType, options);
      results.push(result);
    }

    // 合并结果
    return this.mergeParseResults(results);
  }

  private mergeParseResults(results: ParseResult[]): ParseResult {
    const merged: ParseResult = {
      processes: [],
      warnings: [],
      metadata: {
        parseTime: 0,
        llmModel: results[0]?.metadata.llmModel || 'claude-opus-4-6',
        llmTokens: 0,
        totalEndpoints: 0,
        businessEndpoints: 0,
        filteredEndpoints: 0,
      },
    };

    results.forEach((result) => {
      merged.processes.push(...result.processes);
      merged.warnings.push(...result.warnings);
      merged.metadata.parseTime += result.metadata.parseTime;
      merged.metadata.llmTokens += result.metadata.llmTokens;
    });

    // 去重
    merged.processes = this.deduplicateProcesses(merged.processes);

    return merged;
  }

  private deduplicateProcesses(processes: ParsedProcess[]): ParsedProcess[] {
    const seen = new Set<string>();
    return processes.filter((process) => {
      if (seen.has(process.processCode)) {
        return false;
      }
      seen.add(process.processCode);
      return true;
    });
  }
}