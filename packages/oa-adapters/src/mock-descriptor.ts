import type { AdapterConnectionConfig } from './index';
import type { AdapterDescriptor } from './registry';
import { MockOAAdapter } from './mock-adapter';

/**
 * Mock Adapter Descriptor — fallback adapter for testing and development.
 *
 * Match heuristics:
 *   - vendor name contains 'mock'  → 50
 *   - Always returns 1 as fallback (lowest priority)
 */
export const MockDescriptor: AdapterDescriptor = {
  id: 'mock',
  name: 'Mock OA Adapter',
  vendor: 'MockOA',
  authTypes: ['apikey', 'basic', 'oauth2', 'cookie'],
  capabilities: {
    supportsDiscovery: true,
    supportsSubmit: true,
    supportsStatusQuery: true,
    supportsReferenceData: true,
    supportsCancel: true,
    supportsUrge: true,
    supportsDelegate: true,
    supportsSupplement: true,
    supportsWebhook: false,
  },

  match(config: AdapterConnectionConfig): number {
    const vendor = (config.oaVendor || '').toLowerCase();
    if (vendor.includes('mock')) return 50;
    // Fallback: always match with lowest priority
    return 1;
  },

  create(config: AdapterConnectionConfig) {
    return new MockOAAdapter({
      oaType: config.oaType,
      flows: config.flows || [],
      simulateDelay: 100,
    });
  },
};
