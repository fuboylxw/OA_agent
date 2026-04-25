import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig } from '@uniflow/agent-kernel';
import {
  OADiscoveryInputSchema,
  OADiscoveryOutputSchema,
  type OADiscoveryInput,
  type OADiscoveryOutput,
} from '@uniflow/shared-schema';
import {
  detectCapabilities,
  calculateOCL,
  SystemInferenceEngine,
  type OCLInput,
  type SystemAuthType,
} from '@uniflow/compat-engine';
import { AdapterFactory, hasLifecycle } from '@uniflow/oa-adapters';

@Injectable()
export class OADiscoveryAgent extends BaseAgent<OADiscoveryInput, OADiscoveryOutput> {
  private readonly logger = new Logger(OADiscoveryAgent.name);
  private readonly systemInferenceEngine = new SystemInferenceEngine();

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
    const baseUrl = input.oaUrl ? new URL(input.oaUrl).origin : '';
    const systemInference = await this.systemInferenceEngine.infer({
      baseUrl,
      oaUrl: input.oaUrl,
      openApiUrl: input.openApiUrl,
      harFileUrl: input.harFileUrl,
      sourceBundleUrl: input.sourceBundleUrl,
      userAuth: {
        token: input.oaToken,
      },
      trace: {
        scope: 'api.discovery.system_inference',
        traceId: context.traceId,
        tenantId: context.tenantId,
        userId: context.userId,
      },
    });

    const authType = this.normalizeDiscoveryAuthType(systemInference.preferredAuthType, input);
    const authConfig = this.buildAuthConfig(input, authType, systemInference);
    const connectionConfig = {
      oaType: systemInference.oaType,
      baseUrl,
      authType,
      authConfig,
    } as const;

    let adapter;
    try {
      adapter = await AdapterFactory.createAdapterAsync(connectionConfig);

      const discoverResult = await adapter.discover();
      const capabilities = this.inferCapabilities(discoverResult, input);
      const oclResult = calculateOCL(capabilities);
      const confidence = discoverResult.discoveredFlows.length > 0
        ? systemInference.llmSucceeded ? 0.92 : 0.82
        : systemInference.llmSucceeded ? 0.68 : 0.56;

      return {
        oaVendor: discoverResult.oaVendor,
        oaVersion: discoverResult.oaVersion,
        oaType: discoverResult.oaType,
        authType: discoverResult.authType,
        authConfig: {
          type: discoverResult.authType,
          inferredBy: systemInference.source,
          signals: systemInference.signals,
          headerName: authConfig.headerName,
          headerPrefix: authConfig.headerPrefix,
        },
        discoveredFlows: discoverResult.discoveredFlows,
        oclLevel: oclResult.level,
        confidence,
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

  private normalizeDiscoveryAuthType(
    inferredAuthType: SystemAuthType,
    input: OADiscoveryInput,
  ): 'oauth2' | 'basic' | 'apikey' | 'cookie' {
    if (inferredAuthType === 'basic') {
      return 'basic';
    }
    if (inferredAuthType === 'cookie') {
      return 'cookie';
    }
    if ((inferredAuthType === 'bearer' || inferredAuthType === 'oauth2') && input.oaToken) {
      return 'apikey';
    }
    if (inferredAuthType === 'oauth2') {
      return 'oauth2';
    }
    if (input.harFileUrl) {
      return 'cookie';
    }
    return 'apikey';
  }

  private buildAuthConfig(
    input: OADiscoveryInput,
    authType: 'oauth2' | 'basic' | 'apikey' | 'cookie',
    inference: Awaited<ReturnType<SystemInferenceEngine['infer']>>,
  ): Record<string, any> {
    if (!input.oaToken) {
      return {};
    }

    if (authType === 'oauth2') {
      return {
        token: input.oaToken,
        accessToken: input.oaToken,
        headerName: inference.authHint?.headerName || 'Authorization',
        headerPrefix: inference.authHint?.headerPrefix || 'Bearer ',
      };
    }

    return {
      token: input.oaToken,
      headerName: inference.authHint?.headerName,
      headerPrefix: inference.authHint?.headerPrefix,
    };
  }

  private inferCapabilities(
    discoverResult: any,
    input: OADiscoveryInput,
  ): OCLInput {
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
