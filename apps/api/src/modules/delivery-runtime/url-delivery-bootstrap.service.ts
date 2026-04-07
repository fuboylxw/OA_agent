import { Injectable } from '@nestjs/common';
import { URL_DELIVERY_PATH } from '@uniflow/shared-types';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { PlatformTicketBroker } from '../adapter-runtime/platform-ticket-broker';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';

@Injectable()
export class UrlDeliveryBootstrapService {
  private readonly ticketBroker = new PlatformTicketBroker();

  constructor(private readonly adapterRuntimeService: AdapterRuntimeService) {}

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
    const authConfig = await this.adapterRuntimeService.resolveAuthConfigForExecution(connector, {
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const [rpaFlow] = await this.adapterRuntimeService.loadRpaFlowsForConnector(
      input.connectorId,
      [{ flowCode: input.processCode, flowName: input.processName }],
    );
    const definition = rpaFlow?.rpaDefinition;
    const ticket = definition
      ? await this.ticketBroker.issueTicket({
          connectorId: input.connectorId,
          processCode: input.processCode,
          action: input.action,
          authConfig,
          flow: definition,
        })
      : { metadata: { source: 'missing_rpa_flow' } };

    return {
      path: URL_DELIVERY_PATH,
      action: input.action,
      authConfig,
      rpaFlow,
      ticket,
      runtime: {
        ...(definition?.runtime || {}),
      },
      navigation: {
        entryUrl: definition?.platform?.entryUrl,
        jumpUrlTemplate: definition?.platform?.jumpUrlTemplate,
        ticketBrokerUrl: definition?.platform?.ticketBrokerUrl,
      },
    };
  }
}
