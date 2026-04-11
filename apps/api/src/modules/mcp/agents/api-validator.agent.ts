import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory } from '@uniflow/agent-kernel';
import { z } from 'zod';
import axios from 'axios';

const ApiValidatorInputSchema = z.object({
  baseUrl: z.string(),
  authConfig: z.any(),
  endpoint: z.object({
    path: z.string(),
    method: z.string(),
    parameters: z.array(z.any()),
    requestBody: z.any().optional(),
  }),
});

const ApiValidatorOutputSchema = z.object({
  isAccessible: z.boolean(),
  statusCode: z.number().optional(),
  responseTime: z.number().optional(), // in ms
  errorMessage: z.string().optional(),
  requiredParams: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      description: z.string().optional(),
      sampleValue: z.any().optional(),
    }),
  ),
  sampleRequest: z.any().optional(),
  sampleResponse: z.any().optional(),
  validationResult: z.object({
    canConnect: z.boolean(),
    authValid: z.boolean(),
    endpointExists: z.boolean(),
    recommendation: z.string(),
  }),
});

type ApiValidatorInput = z.infer<typeof ApiValidatorInputSchema>;
type ApiValidatorOutput = z.infer<typeof ApiValidatorOutputSchema>;

/**
 * 智能体：API验证器
 *
 * 功能：
 * 1. 验证API端点的可访问性
 * 2. 测试认证配置是否正确
 * 3. 分析需要的参数和数据
 * 4. 生成测试用例
 */
@Injectable()
export class ApiValidatorAgent extends BaseAgent<
  ApiValidatorInput,
  ApiValidatorOutput
> {
  private readonly logger = new Logger(ApiValidatorAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();

  constructor() {
    const config: AgentConfig = {
      name: 'api-validator',
      description: 'Validate API endpoint accessibility and generate test cases',
      inputSchema: ApiValidatorInputSchema,
      outputSchema: ApiValidatorOutputSchema,
    };
    super(config);
  }

  protected async run(
    input: ApiValidatorInput,
    context: AgentContext,
  ): Promise<ApiValidatorOutput> {
    this.logger.log(`Validating ${input.endpoint.method} ${input.endpoint.path}`);

    const startTime = Date.now();
    let validationResult: any = {
      canConnect: false,
      authValid: false,
      endpointExists: false,
      recommendation: '',
    };

    try {
      // 1. 测试连接性
      const connectResult = await this.testConnection(input.baseUrl);
      validationResult.canConnect = connectResult.success;

      // 2. 测试端点（使用OPTIONS或HEAD方法）
      const endpointResult = await this.testEndpoint(
        input.baseUrl,
        input.endpoint.path,
        input.authConfig,
      );

      validationResult.authValid = endpointResult.authValid;
      validationResult.endpointExists = endpointResult.exists;

      const responseTime = Date.now() - startTime;

      // 3. 分析参数需求
      const requiredParams = await this.analyzeParameters(
        input.endpoint.parameters,
        input.endpoint.requestBody,
      );

      // 4. 生成建议
      validationResult.recommendation = this.generateRecommendation(validationResult);

      return {
        isAccessible: validationResult.canConnect && validationResult.endpointExists,
        statusCode: endpointResult.statusCode,
        responseTime,
        requiredParams,
        sampleRequest: this.generateSampleRequest(input.endpoint, requiredParams),
        validationResult,
      };
    } catch (error: any) {
      this.logger.error(`Validation failed: ${error.message}`);

      validationResult.recommendation = `验证失败: ${error.message}`;

      return {
        isAccessible: false,
        errorMessage: error.message,
        requiredParams: [],
        validationResult,
      };
    }
  }

  /**
   * 测试基础连接
   */
  private async testConnection(baseUrl: string): Promise<{ success: boolean }> {
    try {
      await axios.get(baseUrl, { timeout: 5000, validateStatus: () => true });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * 测试端点
   */
  private async testEndpoint(
    baseUrl: string,
    path: string,
    authConfig: any,
  ): Promise<{ exists: boolean; authValid: boolean; statusCode?: number }> {
    const url = this.buildFullUrl(baseUrl, path);
    const headers: any = {};

    // 配置认证
    if (authConfig.type === 'apikey') {
      headers[authConfig.headerName || 'X-API-Key'] = authConfig.apiKey;
    } else if (authConfig.type === 'bearer') {
      headers['Authorization'] = `Bearer ${authConfig.token}`;
    }

    try {
      // 先尝试OPTIONS
      const optionsResponse = await axios.options(url, {
        headers,
        timeout: 5000,
        validateStatus: () => true,
      });

      if (optionsResponse.status === 200 || optionsResponse.status === 204) {
        return { exists: true, authValid: true, statusCode: optionsResponse.status };
      }

      // 如果OPTIONS不支持，尝试HEAD
      const headResponse = await axios.head(url, {
        headers,
        timeout: 5000,
        validateStatus: () => true,
      });

      const exists = headResponse.status < 500;
      const authValid = headResponse.status !== 401 && headResponse.status !== 403;

      return { exists, authValid, statusCode: headResponse.status };
    } catch (error: any) {
      this.logger.error(`Endpoint test failed: ${error.message}`);
      return { exists: false, authValid: false };
    }
  }

  /**
   * 分析参数需求
   */
  private async analyzeParameters(
    parameters: any[],
    requestBody: any,
  ): Promise<any[]> {
    const requiredParams: any[] = [];

    // 分析URL参数和查询参数
    for (const param of parameters) {
      requiredParams.push({
        name: param.name,
        type: param.type || 'string',
        required: param.required || false,
        description: param.description || '',
        sampleValue: this.generateSampleValue(param.type || 'string'),
      });
    }

    // 分析请求体
    if (requestBody?.properties) {
      for (const [key, value] of Object.entries(requestBody.properties)) {
        const prop = value as any;
        requiredParams.push({
          name: key,
          type: prop.type || 'string',
          required: requestBody.required?.includes(key) || false,
          description: prop.description || '',
          sampleValue: this.generateSampleValue(prop.type || 'string'),
        });
      }
    }

    return requiredParams;
  }

  /**
   * 生成示例值
   */
  private generateSampleValue(type: string): any {
    switch (type) {
      case 'string':
        return '示例文本';
      case 'number':
      case 'integer':
        return 100;
      case 'boolean':
        return true;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return null;
    }
  }

  /**
   * 生成示例请求
   */
  private generateSampleRequest(endpoint: any, requiredParams: any[]): any {
    const sampleRequest: any = {
      method: endpoint.method,
      path: endpoint.path,
    };

    const queryParams: any = {};
    const bodyParams: any = {};

    for (const param of requiredParams) {
      if (param.required) {
        if (endpoint.method === 'GET') {
          queryParams[param.name] = param.sampleValue;
        } else {
          bodyParams[param.name] = param.sampleValue;
        }
      }
    }

    if (Object.keys(queryParams).length > 0) {
      sampleRequest.query = queryParams;
    }

    if (Object.keys(bodyParams).length > 0) {
      sampleRequest.body = bodyParams;
    }

    return sampleRequest;
  }

  /**
   * 生成建议
   */
  private generateRecommendation(validationResult: any): string {
    if (!validationResult.canConnect) {
      return '无法连接到API服务器，请检查baseUrl是否正确，以及网络连接是否正常。';
    }

    if (!validationResult.authValid) {
      return '认证失败，请检查认证配置（API Key、Token等）是否正确。';
    }

    if (!validationResult.endpointExists) {
      return 'API端点不存在或不可访问，请检查路径是否正确。';
    }

    return 'API端点验证通过，可以正常使用。';
  }

  private buildFullUrl(baseUrl: string, path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}