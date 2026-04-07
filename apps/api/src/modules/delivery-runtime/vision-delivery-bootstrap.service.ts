import { Injectable } from '@nestjs/common';
import { VISION_DELIVERY_PATH } from '@uniflow/shared-types';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { PlatformTicketBroker } from '../adapter-runtime/platform-ticket-broker';
import type { VisionDeliveryExecutionContext } from './delivery-bootstrap.types';

@Injectable()
export class VisionDeliveryBootstrapService {
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
  }): Promise<VisionDeliveryExecutionContext> {
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
    const uiHints = input.uiHints || {};
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
      path: VISION_DELIVERY_PATH,
      action: input.action,
      authConfig,
      rpaFlow,
      ticket,
      runtime: {
        ...(definition?.runtime || {}),
        executorMode: 'browser',
        browserProvider: definition?.runtime?.browserProvider || 'playwright',
      },
      observation: {
        startContext: this.resolveStartContext(definition?.platform?.entryUrl, uiHints.visionStartContext),
        templateBundleRef: typeof uiHints.visionTemplateBundleRef === 'string'
          ? uiHints.visionTemplateBundleRef
          : undefined,
        ocrReady: Boolean(uiHints.visionOcrReady || this.hasImageTargets(rpaFlow?.rpaDefinition)),
        snapshotMode: definition?.runtime?.snapshotMode || 'structured-text',
      },
    };
  }

  private resolveStartContext(entryUrl: string | undefined, raw: unknown): VisionDeliveryExecutionContext['observation']['startContext'] {
    if (raw === 'portal_home' || raw === 'attach_session' || raw === 'manual_opened' || raw === 'local_app') {
      return raw;
    }

    if (entryUrl) {
      return 'portal_home';
    }

    return undefined;
  }

  private hasImageTargets(flow: { actions?: { submit?: { steps?: Array<{ target?: { kind?: string } }> }; queryStatus?: { steps?: Array<{ target?: { kind?: string } }> } } } | undefined) {
    if (!flow) {
      return false;
    }
    const steps = [
      ...(flow.actions?.submit?.steps || []),
      ...(flow.actions?.queryStatus?.steps || []),
    ];
    return steps.some((step) => step.target?.kind === 'image');
  }
}
