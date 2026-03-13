import axios, { AxiosInstance } from 'axios';
import { recordRuntimeDiagnostic, RuntimeDiagnosticTraceContext } from './runtime-diagnostics';

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

// ============================================================
// Tool Calling Types (function calling support)
// ============================================================

/** Tool definition passed to LLM */
export interface LLMToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

/** Tool call returned by LLM */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Chat options — tools, tool_choice, etc. */
export interface LLMChatOptions {
  tools?: LLMToolDef[];
  /** 'auto' | 'none' | { type: 'function', function: { name: string } } */
  toolChoice?: any;
  trace?: RuntimeDiagnosticTraceContext;
}

// ============================================================
// Message Types (extended for tool calling)
// ============================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present when role='assistant' and LLM wants to call tools */
  tool_calls?: LLMToolCall[];
  /** Present when role='tool' — references the tool_call id */
  tool_call_id?: string;
  /** Tool name, used by some providers when role='tool' */
  name?: string;
}

// ============================================================
// Response Types
// ============================================================

export interface LLMResponse {
  content: string | null;
  /** Tool calls requested by the LLM */
  toolCalls?: LLMToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  /** 'stop' = done, 'tool_calls' = needs tool execution, 'length' = truncated */
  finishReason?: string;
}

// ============================================================
// Utility: build system prompt helper
// ============================================================

export function buildSystemPrompt(parts: string[]): string {
  return parts.filter(Boolean).join('\n\n');
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
  protected abstract formatRequest(messages: LLMMessage[], options?: LLMChatOptions): any;
  protected abstract parseResponse(response: any): LLMResponse;

  protected async executeChatRequest(
    requestPath: string,
    requestBody: any,
    messages: LLMMessage[],
    options?: LLMChatOptions,
    errorLabel = 'LLM API Error',
  ): Promise<LLMResponse> {
    const startedAt = Date.now();

    try {
      const response = await this.client.post(requestPath, requestBody);
      const parsed = this.parseResponse(response.data);

      recordRuntimeDiagnostic({
        category: 'llm',
        eventType: 'llm_call',
        level: 'info',
        scope: options?.trace?.scope || 'llm.chat',
        message: parsed.content || 'LLM call completed',
        traceId: options?.trace?.traceId,
        tenantId: options?.trace?.tenantId,
        userId: options?.trace?.userId,
        tags: options?.trace?.tags,
        data: {
          provider: this.config.provider,
          model: parsed.model || this.config.model,
          durationMs: Date.now() - startedAt,
          finishReason: parsed.finishReason,
          usage: parsed.usage,
          request: {
            path: requestPath,
            messageCount: messages.length,
            messages,
            tools: options?.tools?.map((tool) => tool.function.name),
            toolChoice: options?.toolChoice,
          },
          response: {
            content: parsed.content,
            toolCalls: parsed.toolCalls,
          },
          metadata: options?.trace?.metadata,
        },
      });

      return parsed;
    } catch (error: any) {
      recordRuntimeDiagnostic({
        category: 'llm',
        eventType: 'llm_error',
        level: 'error',
        scope: options?.trace?.scope || 'llm.chat',
        message: error.message,
        traceId: options?.trace?.traceId,
        tenantId: options?.trace?.tenantId,
        userId: options?.trace?.userId,
        tags: options?.trace?.tags,
        data: {
          provider: this.config.provider,
          model: this.config.model,
          durationMs: Date.now() - startedAt,
          request: {
            path: requestPath,
            messageCount: messages.length,
            messages,
            tools: options?.tools?.map((tool) => tool.function.name),
            toolChoice: options?.toolChoice,
          },
          error: {
            message: error.message,
            stack: error.stack,
          },
          metadata: options?.trace?.metadata,
        },
      });

      throw new Error(`${errorLabel}: ${error.message}`);
    }
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const requestBody = this.formatRequest(messages, options);
    return this.executeChatRequest('/chat/completions', requestBody, messages, options, 'LLM API Error');
  }
}

// ============================================================
// OpenAI Client (supports function calling)
// ============================================================

export class OpenAIClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  protected formatRequest(messages: LLMMessage[], options?: LLMChatOptions): any {
    const body: any = {
      model: this.config.model,
      messages: messages.map(msg => {
        const m: any = { role: msg.role, content: msg.content };
        if (msg.tool_calls) m.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) m.tool_call_id = msg.tool_call_id;
        if (msg.name) m.name = msg.name;
        return m;
      }),
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 2000,
    };

    if (options?.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    return body;
  }

  protected parseResponse(response: any): LLMResponse {
    const choice = response.choices[0];
    const message = choice.message;

    return {
      content: message.content || null,
      toolCalls: message.tool_calls || undefined,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model: response.model,
      finishReason: choice.finish_reason,
    };
  }
}

// ============================================================
// Anthropic Client (supports tool use)
// ============================================================

export class AnthropicClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
    };
  }

  protected formatRequest(messages: LLMMessage[], options?: LLMChatOptions): any {
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const body: any = {
      model: this.config.model,
      messages: conversationMessages.map(msg => this.formatAnthropicMessage(msg)),
      system: systemMessage?.content || undefined,
      max_tokens: this.config.maxTokens ?? 2000,
      temperature: this.config.temperature ?? 0.7,
    };

    if (options?.tools?.length) {
      body.tools = options.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (options.toolChoice) {
        body.tool_choice = typeof options.toolChoice === 'string'
          ? { type: options.toolChoice }
          : options.toolChoice;
      }
    }

    return body;
  }

  private formatAnthropicMessage(msg: LLMMessage): any {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Assistant message with tool use
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      return { role: 'assistant', content };
    }

    if (msg.role === 'tool') {
      // Tool result
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content || '',
        }],
      };
    }

    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content || '',
    };
  }

  protected parseResponse(response: any): LLMResponse {
    const contentBlocks = response.content || [];
    let textContent = '';
    const toolCalls: LLMToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content: textContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      model: response.model,
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : response.stop_reason,
    };
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const requestBody = this.formatRequest(messages, options);
    return this.executeChatRequest('/messages', requestBody, messages, options, 'Anthropic API Error');
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

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const requestBody = this.formatRequest(messages, options);
    return this.executeChatRequest(
      `/openai/deployments/${this.config.model}/chat/completions?api-version=2024-02-15-preview`,
      requestBody,
      messages,
      options,
      'Azure OpenAI API Error',
    );
  }
}

// ============================================================
// Ollama Client (Local LLM — tool calling support varies)
// ============================================================

export class OllamaClient extends BaseLLMClient {
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  protected formatRequest(messages: LLMMessage[], options?: LLMChatOptions): any {
    const body: any = {
      model: this.config.model,
      messages: messages.map(msg => {
        const m: any = { role: msg.role, content: msg.content };
        if (msg.tool_calls) m.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) m.tool_call_id = msg.tool_call_id;
        return m;
      }),
      stream: false,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: this.config.maxTokens ?? 2000,
      },
    };

    if (options?.tools?.length) {
      body.tools = options.tools;
    }

    return body;
  }

  protected parseResponse(response: any): LLMResponse {
    const message = response.message || response.choices?.[0]?.message;
    return {
      content: message?.content || null,
      toolCalls: message?.tool_calls || undefined,
      model: response.model,
      finishReason: message?.tool_calls?.length ? 'tool_calls' : 'stop',
    };
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const requestBody = this.formatRequest(messages, options);
    return this.executeChatRequest('/api/chat', requestBody, messages, options, 'Ollama API Error');
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
      case 'custom':
        return new OpenAIClient(config); // Custom uses OpenAI-compatible API
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }

  static createFromEnv(): BaseLLMClient {
    const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;
    return LLMClientFactory.create({
      provider,
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      baseURL: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
      timeout: parseInt(process.env.LLM_TIMEOUT || '60000', 10),
    });
  }
}
