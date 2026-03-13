import { TokenHeaderAdapter, type TokenHeaderConfig } from './token-header-adapter';
import { CookieSessionAdapter, type CookieSessionConfig } from './cookie-session-adapter';
import { OAuth2RefreshAdapter, type OAuth2RefreshConfig } from './oauth2-refresh-adapter';
import { SoapXmlAdapter, type SoapXmlConfig } from './soap-xml-adapter';
import { MockOAAdapter } from './mock-adapter';
import { AdapterRegistry } from './registry';
import type { AdapterDescriptor, AdapterCapabilities, AdapterMatchFn, AdapterLifecycle } from './registry';
import { hasLifecycle } from './registry';
import { TokenHeaderDescriptor } from './token-header-descriptor';
import { CookieSessionDescriptor } from './cookie-session-descriptor';
import { OAuth2RefreshDescriptor } from './oauth2-refresh-descriptor';
import { SoapXmlDescriptor } from './soap-xml-descriptor';
import { MockDescriptor } from './mock-descriptor';

// ============================================================
// OA Adapter Interface
// ============================================================

export interface OAAdapter {
  discover(): Promise<DiscoverResult>;
  healthCheck(): Promise<HealthCheckResult>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  queryStatus(submissionId: string): Promise<StatusResult>;
  listReferenceData?(datasetCode: string): Promise<ReferenceDataResult>;
  cancel?(submissionId: string): Promise<CancelResult>;
  urge?(submissionId: string): Promise<UrgeResult>;
  delegate?(request: DelegateRequest): Promise<DelegateResult>;
  supplement?(request: SupplementRequest): Promise<SupplementResult>;
}

export interface DiscoverResult {
  oaVendor: string;
  oaVersion?: string;
  oaType: 'openapi' | 'form-page' | 'hybrid';
  authType: 'oauth2' | 'basic' | 'apikey' | 'cookie';
  discoveredFlows: Array<{
    flowCode: string;
    flowName: string;
    entryUrl?: string;
    submitUrl?: string;
    queryUrl?: string;
  }>;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface SubmitRequest {
  flowCode: string;
  formData: Record<string, any>;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface SubmitResult {
  success: boolean;
  submissionId?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface StatusResult {
  status: string;
  statusDetail?: Record<string, any>;
  timeline?: Array<{
    timestamp: string;
    status: string;
    operator?: string;
    comment?: string;
  }>;
}

export interface ReferenceDataResult {
  datasetCode: string;
  datasetName: string;
  datasetType: string;
  syncMode: 'full' | 'incremental' | 'ttl';
  sourceVersion?: string;
  items: Array<{
    remoteItemId?: string;
    itemKey: string;
    itemLabel: string;
    itemValue?: string;
    parentKey?: string;
    payload?: Record<string, any>;
  }>;
}

export interface CancelResult {
  success: boolean;
  message?: string;
}

export interface UrgeResult {
  success: boolean;
  message?: string;
}

export interface DelegateRequest {
  submissionId: string;
  targetUserId: string;
  reason?: string;
}

export interface DelegateResult {
  success: boolean;
  message?: string;
}

export interface SupplementRequest {
  submissionId: string;
  supplementData: Record<string, any>;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface SupplementResult {
  success: boolean;
  message?: string;
}

export interface AdapterConnectionConfig {
  oaVendor?: string;
  oaType: 'openapi' | 'form-page' | 'hybrid';
  baseUrl: string;
  authType: string;
  authConfig?: Record<string, any>;
  flows?: Array<{ flowCode: string; flowName: string }>;
}

// ============================================================
// Bootstrap: register built-in adapters
// ============================================================

function ensureBuiltinAdaptersRegistered() {
  const registry = AdapterRegistry.getInstance();
  if (registry.size > 0) return;

  registry.register(TokenHeaderDescriptor);
  registry.register(CookieSessionDescriptor);
  registry.register(OAuth2RefreshDescriptor);
  registry.register(SoapXmlDescriptor);
  registry.register(MockDescriptor);
}

ensureBuiltinAdaptersRegistered();

// ============================================================
// AdapterFactory — facade over AdapterRegistry
// ============================================================

export class AdapterFactory {
  static createMockAdapter(
    oaType: 'openapi' | 'form-page' | 'hybrid',
    flows: Array<{ flowCode: string; flowName: string }>,
  ): OAAdapter {
    return new MockOAAdapter({ oaType, flows, simulateDelay: 100 });
  }

  static createAdapter(config: AdapterConnectionConfig): OAAdapter {
    ensureBuiltinAdaptersRegistered();
    return AdapterRegistry.getInstance().createAdapterSync(config);
  }

  static async createAdapterAsync(config: AdapterConnectionConfig): Promise<OAAdapter> {
    ensureBuiltinAdaptersRegistered();
    return AdapterRegistry.getInstance().createAdapter(config);
  }

  static getRegistry(): AdapterRegistry {
    ensureBuiltinAdaptersRegistered();
    return AdapterRegistry.getInstance();
  }
}

// ============================================================
// Re-exports: adapters by API pattern name
// ============================================================

export { TokenHeaderAdapter, type TokenHeaderConfig };
export { CookieSessionAdapter, type CookieSessionConfig };
export { OAuth2RefreshAdapter, type OAuth2RefreshConfig };
export { SoapXmlAdapter, type SoapXmlConfig };
export { MockOAAdapter };

// Registry & descriptors
export { AdapterRegistry, hasLifecycle };
export { TokenHeaderDescriptor };
export { CookieSessionDescriptor };
export { OAuth2RefreshDescriptor };
export { SoapXmlDescriptor };
export { MockDescriptor };
export type { AdapterDescriptor, AdapterCapabilities, AdapterMatchFn, AdapterLifecycle };
