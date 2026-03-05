import { Injectable } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig } from '@uniflow/agent-kernel';
import {
  OADiscoveryInputSchema,
  OADiscoveryOutputSchema,
  type OADiscoveryInput,
  type OADiscoveryOutput,
} from '@uniflow/shared-schema';
import { detectCapabilities, calculateOCL } from '@uniflow/compat-engine';

@Injectable()
export class OADiscoveryAgent extends BaseAgent<OADiscoveryInput, OADiscoveryOutput> {
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
    // Detect O2OA system
    if (input.oaUrl && input.oaUrl.includes('x_desktop')) {
      return await this.discoverO2OA(input);
    }

    // Fallback to mock implementation for other OA systems
    return await this.discoverMock(input);
  }

  private async discoverO2OA(input: OADiscoveryInput): Promise<OADiscoveryOutput> {
    const { O2OAAdapter } = await import('@uniflow/oa-adapters');

    // Extract base URL from oaUrl
    const baseUrl = new URL(input.oaUrl!).origin;

    // Get token from environment or use provided token
    const token = process.env.O2OA_TOKEN || input.oaToken;

    if (!token) {
      throw new Error('O2OA token is required. Please set O2OA_TOKEN environment variable or provide oaToken in input.');
    }

    const adapter = new O2OAAdapter({ baseUrl, token });

    try {
      // Discover O2OA applications and processes
      const discoverResult = await adapter.discover();

      // Calculate OCL based on O2OA capabilities
      const oclResult = calculateOCL({
        hasApi: true,
        hasOpenApi: false,
        hasAuth: true,
        canReadUsers: true,
        canReadFlows: true,
        canReadStatus: true,
        canSubmit: true,
        submitStable: true,
        hasCallback: false,
        hasRealtimePermission: false,
        hasIdempotent: false,
        canCancel: true,
        canUrge: true,
        canDelegate: false,
        canSupplement: false,
      });

      return {
        oaVendor: discoverResult.oaVendor,
        oaVersion: discoverResult.oaVersion,
        oaType: discoverResult.oaType,
        authType: discoverResult.authType,
        authConfig: {
          type: 'apikey',
          endpoint: '/x_organization_assemble_authentication/jaxrs/authentication',
        },
        discoveredFlows: discoverResult.discoveredFlows,
        oclLevel: oclResult.level,
        confidence: 0.95,
      };
    } catch (error: any) {
      throw new Error(`Failed to discover O2OA: ${error.message}`);
    }
  }

  private async discoverMock(input: OADiscoveryInput): Promise<OADiscoveryOutput> {
    // Mock implementation for other OA systems
    let oaType: 'openapi' | 'form-page' | 'hybrid' = 'openapi';
    let authType: 'oauth2' | 'basic' | 'apikey' | 'cookie' = 'apikey';
    let discoveredFlows: Array<{
      flowCode: string;
      flowName: string;
      entryUrl?: string;
      submitUrl?: string;
      queryUrl?: string;
    }> = [];

    if (input.openApiUrl) {
      oaType = 'openapi';
      authType = 'apikey';
      discoveredFlows = [
        {
          flowCode: 'travel_expense',
          flowName: '差旅费报销',
          entryUrl: '/api/flows/travel_expense',
          submitUrl: '/api/flows/travel_expense/submit',
          queryUrl: '/api/flows/travel_expense/status',
        },
        {
          flowCode: 'leave_request',
          flowName: '请假申请',
          entryUrl: '/api/flows/leave_request',
          submitUrl: '/api/flows/leave_request/submit',
          queryUrl: '/api/flows/leave_request/status',
        },
      ];
    } else if (input.harFileUrl) {
      oaType = 'form-page';
      authType = 'cookie';
      discoveredFlows = [
        {
          flowCode: 'purchase_request',
          flowName: '采购申请',
          entryUrl: '/forms/purchase',
          submitUrl: '/forms/purchase/submit',
        },
      ];
    } else {
      oaType = 'hybrid';
      authType = 'oauth2';
      discoveredFlows = [
        {
          flowCode: 'meeting_room',
          flowName: '会议室预约',
          entryUrl: '/api/meeting_room',
          submitUrl: '/api/meeting_room/submit',
          queryUrl: '/api/meeting_room/status',
        },
      ];
    }

    const oclResult = calculateOCL({
      hasApi: true,
      hasOpenApi: !!input.openApiUrl,
      hasAuth: true,
      canReadUsers: true,
      canReadFlows: true,
      canReadStatus: true,
      canSubmit: true,
      submitStable: false,
      hasCallback: false,
      hasRealtimePermission: false,
      hasIdempotent: false,
      canCancel: false,
      canUrge: false,
      canDelegate: false,
      canSupplement: false,
    });

    return {
      oaVendor: 'MockOA',
      oaVersion: '1.0.0',
      oaType,
      authType,
      authConfig: {
        type: authType,
        endpoint: '/auth/token',
      },
      discoveredFlows,
      oclLevel: oclResult.level,
      confidence: 0.85,
    };
  }
}
