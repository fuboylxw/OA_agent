import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig } from '@uniflow/agent-kernel';
import {
  OADiscoveryInputSchema,
  OADiscoveryOutputSchema,
  type OADiscoveryInput,
  type OADiscoveryOutput,
} from '@uniflow/shared-schema';
import { detectCapabilities, calculateOCL } from '@uniflow/compat-engine';
import { AdapterFactory, hasLifecycle } from '@uniflow/oa-adapters';

@Injectable()
export class OADiscoveryAgent extends BaseAgent<OADiscoveryInput, OADiscoveryOutput> {
  private readonly logger = new Logger(OADiscoveryAgent.name);

  constructor() {
    const config: AgentConfig = {
      name: 'oa-discovery',
      description: 'Discovers OA system capabilities and compatibility level',
      inputSchema: OADiscoveryInputSchema,
      outputSchema: OADiscoveryOutputSchema,
    };
    super(config);
  }

  protected async run(input: OADiscoveryInput, context: AgentContext): Promise<OADiscoveryOutput> {
    // 通过 AdapterRegistry 自动匹配适配器，不再硬编码特定 OA 系统
    const baseUrl = input.oaUrl ? new URL(input.oaUrl).origin : '';
    const authType = this.inferAuthType(input);
    const authConfig = this.buildAuthConfig(input, authType);

    const connectionConfig = {
      oaType: (input.openApiUrl ? 'openapi' : input.harFileUrl ? 'form-page' : 'hybrid') as 'openapi' | 'form-page' | 'hybrid',
      baseUrl,
      authType,
      authConfig,
    };

    let adapter;
    try {
      adapter = await AdapterFactory.createAdapterAsync(connectionConfig);

      const discoverResult = await adapter.discover();

      // 根据 discover 结果推断能力
      const capabilities = this.inferCapabilities(discoverResult, input);
      const oclResult = calculateOCL(capabilities);

      return {
        oaVendor: discoverResult.oaVendor,
        oaVersion: discoverResult.oaVersion,
        oaType: discoverResult.oaType,
        authType: discoverResult.authType,
        authConfig: { type: discoverResult.authType },
        discoveredFlows: discoverResult.discoveredFlows,
        oclLevel: oclResult.level,
        confidence: discoverResult.discoveredFlows.length > 0 ? 0.9 : 0.6,
      };
    } catch (error: any) {
      this.logger.error(`Discovery failed: ${error.message}`);
      throw new Error(`Failed to discover OA system: ${error.message}`);
    } finally {
      if (adapter && hasLifecycle(adapter) && (adapter as any).destroy) {
        await (adapter as any).destroy();
      }
    }
  }

  private inferAuthType(input: OADiscoveryInput): string {
    if (input.oaToken) return 'apikey';
    if (input.harFileUrl) return 'cookie';
    if (input.openApiUrl) return 'apikey';
    return 'apikey';
  }

  private buildAuthConfig(input: OADiscoveryInput, authType: string): Record<string, any> {
    if (input.oaToken) {
      return { token: input.oaToken };
    }
    return {};
  }

  private inferCapabilities(
    discoverResult: any,
    input: OADiscoveryInput,
  ): Record<string, boolean> {
    const flows = discoverResult.discoveredFlows || [];
    const hasSubmit = flows.some((f: any) => f.submitUrl);
    const hasQuery = flows.some((f: any) => f.queryUrl);

    return {
      hasApi: true,
      hasOpenApi: !!input.openApiUrl,
      hasAuth: true,
      canReadUsers: flows.length > 0,
      canReadFlows: flows.length > 0,
      canReadStatus: hasQuery,
      canSubmit: hasSubmit,
      submitStable: hasSubmit,
      hasCallback: false,
      hasRealtimePermission: false,
      hasIdempotent: false,
      canCancel: false,
      canUrge: false,
      canDelegate: false,
      canSupplement: false,
    };
  }
}
