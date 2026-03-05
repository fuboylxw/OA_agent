import { z } from 'zod';

// ============================================================
// Base Agent Interface
// ============================================================

export interface AgentConfig {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  outputSchema: z.ZodType<any>;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface AgentContext {
  tenantId: string;
  traceId: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs: number;
}

export abstract class BaseAgent<TInput, TOutput> {
  constructor(protected readonly config: AgentConfig) {}

  async execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>> {
    const start = Date.now();
    try {
      // Validate input
      const validatedInput = this.config.inputSchema.parse(input);

      // Execute agent logic
      const result = await this.run(validatedInput, context);

      // Validate output
      const validatedOutput = this.config.outputSchema.parse(result);

      return {
        success: true,
        data: validatedOutput,
        executionTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown agent error',
        executionTimeMs: Date.now() - start,
      };
    }
  }

  protected abstract run(input: TInput, context: AgentContext): Promise<TOutput>;
}

// ============================================================
// Mock Agent (for testing)
// ============================================================

export class MockAgent<TInput, TOutput> extends BaseAgent<TInput, TOutput> {
  constructor(
    config: AgentConfig,
    private readonly mockResponse: TOutput,
  ) {
    super(config);
  }

  protected async run(_input: TInput, _context: AgentContext): Promise<TOutput> {
    return this.mockResponse;
  }
}

// ============================================================
// Agent Registry
// ============================================================

export class AgentRegistry {
  private agents = new Map<string, BaseAgent<any, any>>();

  register(name: string, agent: BaseAgent<any, any>): void {
    this.agents.set(name, agent);
  }

  get<TInput, TOutput>(name: string): BaseAgent<TInput, TOutput> | undefined {
    return this.agents.get(name) as BaseAgent<TInput, TOutput> | undefined;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  list(): string[] {
    return Array.from(this.agents.keys());
  }
}

export const globalAgentRegistry = new AgentRegistry();

// Export LLM client
export * from './llm-client';
