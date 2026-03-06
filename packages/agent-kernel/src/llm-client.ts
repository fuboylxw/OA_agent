import axios, { AxiosInstance } from 'axios';

// ============================================================
// LLM Provider Types
// ============================================================

export type LLMProvider = 'openai' | 'anthropic' | 'azure-openai' | 'ollama' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
}

// ============================================================
// Base LLM Client
// ============================================================

export abstract class BaseLLMClient {
  protected client: AxiosInstance;

  constructor(protected config: LLMConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 60000,
      headers: this.getHeaders(),
    });
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract formatRequest(messages: LLMMessage[]): any;
  protected abstract parseResponse(response: any): LLMResponse;

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const requestBody = this.formatRequest(messages);
      const response = await this.client.post('/chat/completions', requestBody);
      return this.parseResponse(response.data);
    } catch (error: any) {
      throw new Error(`LLM API Error: ${error.message}`);
    }
  }
}

// ============================================================
// OpenAI Client
// ============================================================

export class OpenAIClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  protected formatRequest(messages: LLMMessage[]): any {
    return {
      model: this.config.model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 2000,
    };
  }

  protected parseResponse(response: any): LLMResponse {
    const choice = response.choices[0];
    return {
      content: choice.message.content,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      model: response.model,
      finishReason: choice.finish_reason,
    };
  }
}

// ============================================================
// Anthropic Client
// ============================================================

export class AnthropicClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
    };
  }

  protected formatRequest(messages: LLMMessage[]): any {
    // Anthropic requires system message separately
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    return {
      model: this.config.model,
      messages: conversationMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      system: systemMessage?.content,
      max_tokens: this.config.maxTokens ?? 2000,
      temperature: this.config.temperature ?? 0.7,
    };
  }

  protected parseResponse(response: any): LLMResponse {
    return {
      content: response.content[0].text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      finishReason: response.stop_reason,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const requestBody = this.formatRequest(messages);
      const response = await this.client.post('/messages', requestBody);
      return this.parseResponse(response.data);
    } catch (error: any) {
      throw new Error(`Anthropic API Error: ${error.message}`);
    }
  }
}

// ============================================================
// Azure OpenAI Client
// ============================================================

export class AzureOpenAIClient extends OpenAIClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'api-key': this.config.apiKey || '',
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const requestBody = this.formatRequest(messages);
      // Azure uses deployment name in URL
      const response = await this.client.post(
        `/openai/deployments/${this.config.model}/chat/completions?api-version=2024-02-15-preview`,
        requestBody
      );
      return this.parseResponse(response.data);
    } catch (error: any) {
      throw new Error(`Azure OpenAI API Error: ${error.message}`);
    }
  }
}

// ============================================================
// Ollama Client (Local LLM)
// ============================================================

export class OllamaClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  protected formatRequest(messages: LLMMessage[]): any {
    return {
      model: this.config.model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: false,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: this.config.maxTokens ?? 2000,
      },
    };
  }

  protected parseResponse(response: any): LLMResponse {
    return {
      content: response.message.content,
      model: response.model,
      finishReason: response.done ? 'stop' : 'length',
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const requestBody = this.formatRequest(messages);
      const response = await this.client.post('/api/chat', requestBody);
      return this.parseResponse(response.data);
    } catch (error: any) {
      throw new Error(`Ollama API Error: ${error.message}`);
    }
  }
}

// ============================================================
// LLM Client Factory
// ============================================================

export class LLMClientFactory {
  static create(config: LLMConfig): BaseLLMClient {
    switch (config.provider) {
      case 'openai':
        return new OpenAIClient(config);
      case 'anthropic':
        return new AnthropicClient(config);
      case 'azure-openai':
        return new AzureOpenAIClient(config);
      case 'ollama':
        return new OllamaClient(config);
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }

  static createFromEnv(): BaseLLMClient {
    const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;

    const providerEnvMap: Record<string, { apiKey: string; baseURL: string; model: string }> = {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: process.env.OPENAI_BASE_URL || '',
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      },
      'azure-openai': {
        apiKey: process.env.AZURE_OPENAI_API_KEY || '',
        baseURL: process.env.AZURE_OPENAI_ENDPOINT || '',
        model: process.env.AZURE_OPENAI_MODEL || 'gpt-4',
      },
      ollama: {
        apiKey: '',
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'llama2',
      },
    };

    const envConfig = providerEnvMap[provider] || providerEnvMap.openai;

    return this.create({
      provider,
      apiKey: envConfig.apiKey || undefined,
      baseURL: envConfig.baseURL || undefined,
      model: envConfig.model,
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
    });
  }
}

// ============================================================
// Utility Functions
// ============================================================

export function buildSystemPrompt(role: string, context?: string): string {
  const basePrompt = `You are a helpful AI assistant for an office automation system.`;

  if (context) {
    return `${basePrompt}\n\n${context}`;
  }

  return basePrompt;
}

export function buildUserPrompt(message: string, context?: Record<string, any>): string {
  if (!context) {
    return message;
  }

  const contextStr = Object.entries(context)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');

  return `${message}\n\nContext:\n${contextStr}`;
}
