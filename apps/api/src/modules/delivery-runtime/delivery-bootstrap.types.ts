import type { OAAdapter } from '@uniflow/oa-adapters';
import type { RpaRuntimeDefinition, VisionStartContext } from '@uniflow/shared-types';
import type { PlatformTicketResult } from '../adapter-runtime/platform-ticket-broker';
import type { LoadedRpaFlow } from '../adapter-runtime/prisma-rpa-flow-loader';

export interface ApiDeliveryExecutionContext {
  path: 'api';
  adapter: OAAdapter | null;
}

export interface UrlDeliveryExecutionContext {
  path: 'url';
  action: 'submit' | 'queryStatus';
  authConfig: Record<string, any>;
  rpaFlow?: LoadedRpaFlow;
  ticket: PlatformTicketResult;
  runtime: RpaRuntimeDefinition;
  navigation: {
    entryUrl?: string;
    jumpUrlTemplate?: string;
    ticketBrokerUrl?: string;
    portalUrl?: string;
  };
}

export interface VisionObservationContext {
  startContext?: VisionStartContext;
  templateBundleRef?: string;
  ocrReady: boolean;
  snapshotMode?: RpaRuntimeDefinition['snapshotMode'];
}

export interface VisionDeliveryExecutionContext {
  path: 'vision';
  action: 'submit' | 'queryStatus';
  authConfig: Record<string, any>;
  rpaFlow?: LoadedRpaFlow;
  ticket: PlatformTicketResult;
  runtime: RpaRuntimeDefinition;
  observation: VisionObservationContext;
}
