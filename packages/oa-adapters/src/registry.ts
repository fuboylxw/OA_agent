import type { OAAdapter, AdapterConnectionConfig } from './index';

// ============================================================
// Adapter Descriptor — self-describing metadata for each adapter
// ============================================================

/**
 * Match rule: determines whether a given connection config should use this adapter.
 * Return a score 0–100. Highest score wins. 0 = no match.
 */
export type AdapterMatchFn = (config: AdapterConnectionConfig) => number;

export interface AdapterCapabilities {
  supportsDiscovery: boolean;
  supportsSubmit: boolean;
  supportsStatusQuery: boolean;
  supportsReferenceData: boolean;
  supportsCancel: boolean;
  supportsUrge: boolean;
  supportsDelegate: boolean;
  supportsSupplement: boolean;
  supportsWebhook: boolean;
}

export const DEFAULT_CAPABILITIES: AdapterCapabilities = {
  supportsDiscovery: false,
  supportsSubmit: false,
  supportsStatusQuery: false,
  supportsReferenceData: false,
  supportsCancel: false,
  supportsUrge: false,
  supportsDelegate: false,
  supportsSupplement: false,
  supportsWebhook: false,
};

export interface AdapterDescriptor {
  /** Unique adapter identifier, e.g. 'token-header', 'cookie-session', 'oauth2-refresh' */
  id: string;
  /** Human-readable name */
  name: string;
  /** Vendor name for display */
  vendor: string;
  /** Supported auth types */
  authTypes: string[];
  /** Declared capabilities */
  capabilities: AdapterCapabilities;
  /** Match function: score 0–100 based on connection config */
  match: AdapterMatchFn;
  /** Factory: create an adapter instance from connection config */
  create: (config: AdapterConnectionConfig) => OAAdapter;
}

// ============================================================
// Optional Lifecycle interface — adapters can implement for
// resource management (connection pools, token refresh, etc.)
// ============================================================

export interface AdapterLifecycle {
  /** Called after creation, before first use */
  init?(): Promise<void>;
  /** Called when adapter is no longer needed */
  destroy?(): Promise<void>;
  /** Called when auth token needs refresh */
  refreshAuth?(): Promise<void>;
}

/**
 * Type guard: check if an adapter implements lifecycle hooks
 */
export function hasLifecycle(adapter: OAAdapter): adapter is OAAdapter & AdapterLifecycle {
  const a = adapter as any;
  return typeof a.init === 'function'
    || typeof a.destroy === 'function'
    || typeof a.refreshAuth === 'function';
}

// ============================================================
// Adapter Registry — pluggable, priority-based resolution
// ============================================================

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private descriptors: Map<string, AdapterDescriptor> = new Map();

  private constructor() {}

  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    AdapterRegistry.instance = undefined as any;
  }

  /**
   * Register an adapter descriptor.
   * Throws if an adapter with the same id is already registered.
   */
  register(descriptor: AdapterDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(
        `Adapter "${descriptor.id}" is already registered. `
        + `Use replace() to override, or unregister() first.`,
      );
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  /**
   * Replace an existing adapter descriptor (for hot-swap / override).
   */
  replace(descriptor: AdapterDescriptor): void {
    this.descriptors.set(descriptor.id, descriptor);
  }

  /**
   * Unregister an adapter by id.
   */
  unregister(id: string): boolean {
    return this.descriptors.delete(id);
  }

  /**
   * Resolve the best-matching adapter for a given connection config.
   * Returns null if no adapter matches (score > 0).
   */
  resolve(config: AdapterConnectionConfig): AdapterDescriptor | null {
    let bestDescriptor: AdapterDescriptor | null = null;
    let bestScore = 0;

    for (const descriptor of this.descriptors.values()) {
      const score = descriptor.match(config);
      if (score > bestScore) {
        bestScore = score;
        bestDescriptor = descriptor;
      }
    }

    return bestDescriptor;
  }

  /**
   * Create an adapter instance for the given config.
   * Resolves the best match, creates the adapter, and calls init() if available.
   */
  async createAdapter(config: AdapterConnectionConfig): Promise<OAAdapter> {
    const descriptor = this.resolve(config);
    if (!descriptor) {
      throw new Error(
        `No registered adapter matches the given config `
        + `(vendor=${config.oaVendor}, baseUrl=${config.baseUrl}, authType=${config.authType}). `
        + `Registered adapters: [${this.listIds().join(', ')}]`,
      );
    }

    const adapter = descriptor.create(config);

    if (hasLifecycle(adapter) && adapter.init) {
      await adapter.init();
    }

    return adapter;
  }

  /**
   * Synchronous version — creates adapter without calling init().
   * Use when you need backward compatibility with sync factory patterns.
   */
  createAdapterSync(config: AdapterConnectionConfig): OAAdapter {
    const descriptor = this.resolve(config);
    if (!descriptor) {
      throw new Error(
        `No registered adapter matches the given config `
        + `(vendor=${config.oaVendor}, baseUrl=${config.baseUrl}, authType=${config.authType}). `
        + `Registered adapters: [${this.listIds().join(', ')}]`,
      );
    }

    return descriptor.create(config);
  }

  /**
   * Get a descriptor by id.
   */
  get(id: string): AdapterDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /**
   * List all registered adapter ids.
   */
  listIds(): string[] {
    return [...this.descriptors.keys()];
  }

  /**
   * List all registered descriptors.
   */
  listAll(): AdapterDescriptor[] {
    return [...this.descriptors.values()];
  }

  /**
   * Get capabilities for a specific adapter.
   */
  getCapabilities(id: string): AdapterCapabilities | undefined {
    return this.descriptors.get(id)?.capabilities;
  }

  /**
   * Number of registered adapters.
   */
  get size(): number {
    return this.descriptors.size;
  }
}
