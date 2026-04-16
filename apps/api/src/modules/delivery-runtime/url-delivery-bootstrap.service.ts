import { Injectable } from '@nestjs/common';
import { URL_DELIVERY_PATH } from '@uniflow/shared-types';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { PlatformTicketBroker } from '../adapter-runtime/platform-ticket-broker';
import { OaBackendLoginService } from '../adapter-runtime/oa-backend-login.service';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';
import { UrlPortalSsoBridgeService } from './url-portal-sso-bridge.service';

@Injectable()
export class UrlDeliveryBootstrapService {
  private readonly ticketBroker = new PlatformTicketBroker();

  constructor(
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly urlPortalSsoBridgeService: UrlPortalSsoBridgeService,
    private readonly oaBackendLoginService: OaBackendLoginService,
  ) {}

  async prepare(input: {
    action: 'submit' | 'queryStatus';
    connectorId: string;
    processCode: string;
    processName: string;
    tenantId?: string;
    userId?: string;
    uiHints?: Record<string, any>;
  }): Promise<UrlDeliveryExecutionContext> {
    const connector = await this.adapterRuntimeService.getConnectorWithSecrets(input.connectorId);
    let authConfig = await this.adapterRuntimeService.resolveAuthConfigForExecution(connector, {
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const [rpaFlow] = await this.adapterRuntimeService.loadRpaFlowsForConnector(
      input.connectorId,
      [{ flowCode: input.processCode, flowName: input.processName }],
    );
    const definition = rpaFlow?.rpaDefinition;
    authConfig = await this.refreshBackendLoginIfNeeded({
      connector,
      authConfig,
      flow: definition,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const rawTicket = definition
      ? await this.ticketBroker.issueTicket({
          connectorId: input.connectorId,
          processCode: input.processCode,
          action: input.action,
          authConfig,
          flow: definition,
        })
      : { metadata: { source: 'missing_rpa_flow' } };
    const bridgeResult = definition
      ? await this.urlPortalSsoBridgeService.resolve({
          connectorId: input.connectorId,
          processCode: input.processCode,
          processName: input.processName,
          action: input.action,
          authConfig,
          flow: definition,
          ticket: rawTicket,
        })
      : {
          authConfig,
          ticket: rawTicket,
        };

    return {
      path: URL_DELIVERY_PATH,
      action: input.action,
      authConfig: bridgeResult.authConfig,
      rpaFlow,
      ticket: bridgeResult.ticket,
      runtime: {
        ...(definition?.runtime || {}),
      },
      navigation: {
        entryUrl: definition?.platform?.entryUrl,
        jumpUrlTemplate: definition?.platform?.jumpUrlTemplate,
        ticketBrokerUrl: definition?.platform?.ticketBrokerUrl,
        portalUrl: definition?.platform?.portalSsoBridge?.portalUrl,
      },
    };
  }

  private async refreshBackendLoginIfNeeded(input: {
    connector: {
      id?: string;
      authType: string;
    };
    authConfig: Record<string, any>;
    flow?: any;
    tenantId?: string;
    userId?: string;
  }) {
    if (!this.shouldRefreshBackendLogin(input.authConfig, input.flow)) {
      return input.authConfig;
    }

    const resolved = await this.oaBackendLoginService.resolveExecutionAuthConfig({
      connectorId: String(input.connector.id || ''),
      authType: input.connector.authType,
      authConfig: input.authConfig,
      authScope: {
        tenantId: input.tenantId,
        userId: input.userId,
      },
      flow: input.flow,
    });

    if (!resolved?.authConfig) {
      return input.authConfig;
    }

    return this.mergeAuthConfig(input.authConfig, resolved.authConfig);
  }

  private shouldRefreshBackendLogin(authConfig: Record<string, any>, flow?: any) {
    const platformConfig = this.asRecord(authConfig.platformConfig);
    const backendLogin = this.firstRecord([
      platformConfig.oaBackendLogin,
      platformConfig.backendLogin,
      platformConfig.whiteListLogin,
      platformConfig.whitelistLogin,
    ]);
    if (!backendLogin || backendLogin.enabled === false) {
      return false;
    }

    const runtime = this.asRecord(flow?.runtime);
    const portalBridge = this.asRecord(flow?.platform?.portalSsoBridge);
    const requiresSessionBootstrap = Boolean(
      portalBridge.enabled
      || runtime.preflight
      || runtime.networkSubmit
      || runtime.networkStatus,
    );
    if (!requiresSessionBootstrap) {
      return false;
    }

    return backendLogin.refreshOnExecute !== false;
  }

  private mergeAuthConfig(base: Record<string, any>, patch: Record<string, any>) {
    return {
      ...base,
      ...patch,
      platformConfig: {
        ...this.asRecord(base.platformConfig),
        ...this.asRecord(patch.platformConfig),
      },
    };
  }

  private firstRecord(values: unknown[]) {
    for (const value of values) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
      }
    }
    return null;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }
}
