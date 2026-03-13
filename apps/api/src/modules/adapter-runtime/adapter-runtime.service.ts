import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AdapterFactory,
  AdapterRegistry,
  MockOAAdapter,
  hasLifecycle,
  type OAAdapter,
  type AdapterDescriptor,
  type AdapterCapabilities,
} from '@uniflow/oa-adapters';
import { PrismaService } from '../common/prisma.service';
import { GenericHttpAdapter } from './generic-http-adapter';
import { PrismaEndpointLoader } from './prisma-endpoint-loader';

const SENSITIVE_AUTH_KEYS = new Set([
  'password',
  'token',
  'appSecret',
  'accessToken',
  'refreshToken',
  'secret',
]);

@Injectable()
export class AdapterRuntimeService {
  private readonly logger = new Logger(AdapterRuntimeService.name);
  private readonly endpointLoader: PrismaEndpointLoader;

  constructor(private readonly prisma: PrismaService) {
    this.endpointLoader = new PrismaEndpointLoader(prisma);
  }

  /**
   * Get the adapter registry for custom adapter registration.
   */
  getRegistry(): AdapterRegistry {
    return AdapterFactory.getRegistry();
  }

  /**
   * Register a custom adapter descriptor at runtime.
   */
  registerAdapter(descriptor: AdapterDescriptor): void {
    this.logger.log(`Registering adapter: ${descriptor.id} (${descriptor.name})`);
    this.getRegistry().register(descriptor);
  }

  /**
   * List all registered adapter descriptors.
   */
  listRegisteredAdapters(): Array<{ id: string; name: string; vendor: string; capabilities: AdapterCapabilities }> {
    return this.getRegistry().listAll().map(d => ({
      id: d.id,
      name: d.name,
      vendor: d.vendor,
      capabilities: d.capabilities,
    }));
  }

  async createAdapterForConnector(
    connectorId: string,
    flows?: Array<{ flowCode: string; flowName: string }>,
  ): Promise<OAAdapter> {
    const connector = await this.getConnectorWithSecrets(connectorId);
    const authConfig = await this.resolveAuthConfig(connector);

    const config = {
      oaVendor: connector.oaVendor || undefined,
      oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
      baseUrl: connector.baseUrl,
      authType: connector.authType,
      authConfig,
      flows,
    };

    // 1. Try registry for vendor-specific adapters (if registered)
    const registry = this.getRegistry();
    const descriptor = registry.resolve(config);

    // 2. If resolved to a real adapter (not Mock fallback), use it
    if (descriptor && descriptor.id !== 'mock') {
      this.logger.log(
        `Resolved specific adapter "${descriptor.id}" for connector ${connectorId}`,
      );
      const adapter = descriptor.create(config);
      if (hasLifecycle(adapter) && adapter.init) {
        await adapter.init();
      }
      return adapter;
    }

    // 3. Check if this connector has MCPTool endpoints configured
    //    If yes → use GenericHttpAdapter (config-driven, zero code)
    //    If no  → fall back to MockOAAdapter
    const toolCount = await this.prisma.mCPTool.count({
      where: { connectorId, enabled: true },
    });

    if (toolCount > 0) {
      this.logger.log(
        `Using GenericHttpAdapter for connector ${connectorId} (${toolCount} MCPTool endpoints)`,
      );
      const adapter = new GenericHttpAdapter(
        {
          connectorId,
          baseUrl: connector.baseUrl,
          authType: connector.authType,
          authConfig,
          oaVendor: connector.oaVendor || undefined,
          oaVersion: connector.oaVersion || undefined,
          oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
          healthCheckUrl: connector.healthCheckUrl || undefined,
        },
        this.endpointLoader,
      );
      await adapter.init();
      return adapter;
    }

    // 4. No specific adapter, no MCPTool endpoints → Mock fallback
    this.logger.warn(
      `No specific adapter or MCPTool endpoints for connector ${connectorId}, using MockOAAdapter`,
    );
    return new MockOAAdapter({
      oaType: config.oaType,
      flows: flows || [],
      simulateDelay: 100,
    });
  }

  /**
   * Destroy an adapter, calling lifecycle destroy() if available.
   */
  async destroyAdapter(adapter: OAAdapter): Promise<void> {
    if (hasLifecycle(adapter) && adapter.destroy) {
      await adapter.destroy();
    }
  }

  async getConnectorWithSecrets(connectorId: string) {
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
      include: {
        capability: true,
        secretRef: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    return connector;
  }

  async resolveAuthConfig(connector: {
    id?: string;
    authType: string;
    authConfig: any;
    secretRef?: {
      secretProvider: string;
      secretPath: string;
      secretVersion?: string | null;
    } | null;
  }) {
    const baseConfig = { ...(connector.authConfig as Record<string, any> || {}) };
    const secretRef = connector.secretRef;

    if (!secretRef) {
      return baseConfig;
    }

    const resolvedSecret = await this.resolveSecretPayload(
      connector.id,
      secretRef,
      connector.authType,
    );
    return {
      ...baseConfig,
      ...resolvedSecret,
    };
  }

  private async resolveSecretPayload(
    connectorId: string | undefined,
    secretRef: {
      secretProvider: string;
      secretPath: string;
      secretVersion?: string | null;
    },
    authType: string,
  ) {
    if (secretRef.secretProvider !== 'env') {
      return {};
    }

    const raw = process.env[secretRef.secretPath];
    if (raw) {
      return this.mapRawSecret(raw, authType);
    }

    if (!connectorId) {
      return {};
    }

    const bootstrapSecret = await this.loadBootstrapSecretPayload(connectorId);
    if (bootstrapSecret) {
      this.logger.warn(
        `Secret ${secretRef.secretPath} not found in process env, falling back to latest bootstrap auth for connector ${connectorId}`,
      );
      return bootstrapSecret;
    }

    return {};
  }

  private async loadBootstrapSecretPayload(connectorId: string) {
    const latestPublishedJob = await this.prisma.bootstrapJob.findFirst({
      where: {
        connectorId,
        status: {
          in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'],
        },
      },
      orderBy: [
        { completedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        authConfig: true,
      },
    });

    const authConfig = latestPublishedJob?.authConfig;
    if (!authConfig || typeof authConfig !== 'object' || Array.isArray(authConfig)) {
      return {};
    }

    return this.extractSensitiveAuthFields(authConfig as Record<string, any>);
  }

  private extractSensitiveAuthFields(authConfig: Record<string, any>) {
    return Object.fromEntries(
      Object.entries(authConfig).filter(([key, value]) =>
        SENSITIVE_AUTH_KEYS.has(key) && value !== undefined && value !== null && value !== ''
      ),
    );
  }

  private mapRawSecret(raw: string, authType: string) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, any>;
      }
    } catch {
      // Plain secret values are mapped by auth type below.
    }

    if (authType === 'apikey') {
      return { token: raw };
    }
    if (authType === 'oauth2') {
      return { accessToken: raw };
    }
    if (authType === 'basic' || authType === 'cookie') {
      return { password: raw };
    }

    return { secret: raw };
  }
}
