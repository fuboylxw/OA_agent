import axios from 'axios';
import type { RpaFlowDefinition } from '@uniflow/shared-types';

export interface PlatformTicketRequest {
  connectorId: string;
  processCode: string;
  action: 'submit' | 'queryStatus';
  authConfig: Record<string, any>;
  flow: RpaFlowDefinition;
}

export interface PlatformTicketResult {
  ticket?: string;
  jumpUrl?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
}

export class PlatformTicketBroker {
  async issueTicket(request: PlatformTicketRequest): Promise<PlatformTicketResult> {
    const platformConfig = {
      ...((request.authConfig.platformConfig as Record<string, any> | undefined) || {}),
      ...(request.flow.platform || {}),
    };

    const ticketBrokerUrl = platformConfig.ticketBrokerUrl;
    if (typeof ticketBrokerUrl === 'string' && ticketBrokerUrl) {
      const response = await axios.post(
        ticketBrokerUrl,
        {
          connectorId: request.connectorId,
          processCode: request.processCode,
          action: request.action,
          targetSystem: platformConfig.targetSystem,
        },
        {
          timeout: platformConfig.timeoutMs || 15000,
          headers: this.buildBrokerHeaders(platformConfig),
        },
      );

      const payload = response.data as Record<string, any>;
      return {
        ticket: typeof payload.ticket === 'string' ? payload.ticket : undefined,
        jumpUrl: typeof payload.jumpUrl === 'string' ? payload.jumpUrl : undefined,
        headers: {
          ...(payload.headers as Record<string, string> | undefined),
        },
        metadata: payload,
      };
    }

    if (typeof platformConfig.jumpUrlTemplate === 'string' && platformConfig.jumpUrlTemplate) {
      return {
        jumpUrl: this.interpolate(platformConfig.jumpUrlTemplate, {
          processCode: request.processCode,
          action: request.action,
          targetSystem: platformConfig.targetSystem,
        }),
        metadata: {
          source: 'template',
        },
      };
    }

    return {
      metadata: {
        source: 'none',
      },
    };
  }

  private buildBrokerHeaders(platformConfig: Record<string, any>) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (typeof platformConfig.serviceToken === 'string' && platformConfig.serviceToken) {
      headers.Authorization = `Bearer ${platformConfig.serviceToken}`;
    }

    if (typeof platformConfig.ticketHeaderName === 'string' && platformConfig.ticketHeaderValue) {
      headers[platformConfig.ticketHeaderName] = String(platformConfig.ticketHeaderValue);
    }

    return headers;
  }

  private interpolate(template: string, values: Record<string, any>) {
    return template.replace(/\{([^}]+)\}/g, (_, key: string) => String(values[key] ?? ''));
  }
}
