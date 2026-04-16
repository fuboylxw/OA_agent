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
import { DelegatedCredentialService } from '../delegated-credential/delegated-credential.service';
import { AuthBindingService } from '../auth-binding/auth-binding.service';
import { GenericHttpAdapter } from './generic-http-adapter';
import { PrismaEndpointLoader } from './prisma-endpoint-loader';
import { PrismaRpaFlowLoader } from './prisma-rpa-flow-loader';
import { PlatformTicketBroker } from './platform-ticket-broker';
import { RpaAdapter } from './rpa-adapter';
import { CapabilityRoutedAdapter } from './capability-routed-adapter';
import { LocalRpaExecutor } from './local-rpa-executor';
import { BrowserRpaExecutor } from './browser-rpa-executor';
import { OaBackendLoginService } from './oa-backend-login.service';

const SENSITIVE_AUTH_KEYS = new Set([
  'password',
  'token',
  'appSecret',
  'accessToken',
  'refreshToken',
  'secret',
  'serviceToken',
  'ticketHeaderValue',
]);

export interface ExecutionAuthScope {
  tenantId?: string;
  userId?: string;
}

@Injectable()
export class AdapterRuntimeService {
  private readonly logger = new Logger(AdapterRuntimeService.name);
  private readonly endpointLoader: PrismaEndpointLoader;
  private readonly rpaFlowLoader: PrismaRpaFlowLoader;
  private readonly platformTicketBroker: PlatformTicketBroker;
  private readonly localRpaExecutor: LocalRpaExecutor;
  private readonly browserRpaExecutor: BrowserRpaExecutor;

  constructor(
    private readonly prisma: PrismaService,
    private readonly delegatedCredentialService: DelegatedCredentialService,
    private readonly authBindingService: AuthBindingService,
    private readonly oaBackendLoginService: OaBackendLoginService,
  ) {
    this.endpointLoader = new PrismaEndpointLoader(prisma);
    this.rpaFlowLoader = new PrismaRpaFlowLoader(prisma);
    this.platformTicketBroker = new PlatformTicketBroker();
    this.localRpaExecutor = new LocalRpaExecutor();
    this.browserRpaExecutor = new BrowserRpaExecutor();
  }

  getRegistry(): AdapterRegistry {
    return AdapterFactory.getRegistry();
  }

  registerAdapter(descriptor: AdapterDescriptor): void {
    this.logger.log(`Registering adapter: ${descriptor.id} (${descriptor.name})`);
    this.getRegistry().register(descriptor);
  }

  listRegisteredAdapters(): Array<{ id: string; name: string; vendor: string; capabilities: AdapterCapabilities }> {
    return this.getRegistry().listAll().map((descriptor) => ({
      id: descriptor.id,
      name: descriptor.name,
      vendor: descriptor.vendor,
      capabilities: descriptor.capabilities,
    }));
  }

  async createAdapterForConnector(
    connectorId: string,
    flows?: Array<{ flowCode: string; flowName: string }>,
    authScope?: ExecutionAuthScope,
  ): Promise<OAAdapter> {
    const connector = await this.getConnectorWithSecrets(connectorId);
    const authConfig = await this.resolveAuthConfigForExecution(connector, authScope);
    const loadedRpaFlows = await this.rpaFlowLoader.loadFlows(connectorId);
    const requestedFlowCodes = new Set((flows || []).map((flow) => flow.flowCode));
    const rpaFlows = requestedFlowCodes.size > 0
      ? loadedRpaFlows.filter((flow) => requestedFlowCodes.has(flow.processCode))
      : loadedRpaFlows;

    const config = {
      oaVendor: connector.oaVendor || undefined,
      oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
      baseUrl: connector.baseUrl,
      authType: connector.authType,
      authConfig,
      flows,
    };

    let apiAdapter: OAAdapter | null = null;
    const registry = this.getRegistry();
    const descriptor = registry.resolve(config);

    if (descriptor && descriptor.id !== 'mock') {
      this.logger.log(`Resolved specific adapter "${descriptor.id}" for connector ${connectorId}`);
      apiAdapter = descriptor.create(config);
      if (hasLifecycle(apiAdapter) && apiAdapter.init) {
        await apiAdapter.init();
      }
    }

    const toolCount = await this.prisma.mCPTool.count({
      where: { connectorId, enabled: true },
    });

    if (!apiAdapter && toolCount > 0) {
      this.logger.log(
        `Using GenericHttpAdapter for connector ${connectorId} (${toolCount} MCPTool endpoints)`,
      );
      apiAdapter = new GenericHttpAdapter(
        {
          connectorId,
          baseUrl: connector.baseUrl,
          authType: connector.authType,
          authConfig,
          flows,
          oaVendor: connector.oaVendor || undefined,
          oaVersion: connector.oaVersion || undefined,
          oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
          healthCheckUrl: connector.healthCheckUrl || undefined,
        },
        this.endpointLoader,
      );
      if (hasLifecycle(apiAdapter) && apiAdapter.init) {
        await apiAdapter.init();
      }
    }

    let rpaAdapter: OAAdapter | null = null;
    if (rpaFlows.length > 0) {
      this.logger.log(`Using RpaAdapter for connector ${connectorId} (${rpaFlows.length} RPA flows)`);
      rpaAdapter = new RpaAdapter(
        {
          connectorId,
          baseUrl: connector.baseUrl,
          authType: connector.authType,
          authConfig,
          authScope,
          oaVendor: connector.oaVendor || undefined,
          oaVersion: connector.oaVersion || undefined,
          oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
        },
        rpaFlows,
        this.platformTicketBroker,
        this.localRpaExecutor,
        this.browserRpaExecutor,
        this.oaBackendLoginService,
      );
      if (hasLifecycle(rpaAdapter) && rpaAdapter.init) {
        await rpaAdapter.init();
      }
    }

    if (apiAdapter && rpaAdapter) {
      return new CapabilityRoutedAdapter(apiAdapter, rpaAdapter, rpaFlows);
    }

    if (apiAdapter) {
      return apiAdapter;
    }

    if (rpaAdapter) {
      return rpaAdapter;
    }

    this.logger.warn(
      `No specific adapter, MCPTool endpoints, or RPA flows for connector ${connectorId}, using MockOAAdapter`,
    );
    return new MockOAAdapter({
      oaType: config.oaType,
      flows: flows || [],
      simulateDelay: 100,
    });
  }

  async createApiAdapterForConnector(
    connectorId: string,
    flows?: Array<{ flowCode: string; flowName: string }>,
    authScope?: ExecutionAuthScope,
  ): Promise<OAAdapter | null> {
    const connector = await this.getConnectorWithSecrets(connectorId);
    const authConfig = await this.resolveAuthConfigForExecution(connector, authScope);
    const config = {
      oaVendor: connector.oaVendor || undefined,
      oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
      baseUrl: connector.baseUrl,
      authType: connector.authType,
      authConfig,
      flows,
    };

    let apiAdapter: OAAdapter | null = null;
    const registry = this.getRegistry();
    const descriptor = registry.resolve(config);

    if (descriptor && descriptor.id !== 'mock') {
      this.logger.log(`Resolved specific API adapter "${descriptor.id}" for connector ${connectorId}`);
      apiAdapter = descriptor.create(config);
      if (hasLifecycle(apiAdapter) && apiAdapter.init) {
        await apiAdapter.init();
      }
      return apiAdapter;
    }

    const toolCount = await this.prisma.mCPTool.count({
      where: { connectorId, enabled: true },
    });

    if (toolCount > 0) {
      this.logger.log(
        `Using GenericHttpAdapter for connector ${connectorId} (${toolCount} MCPTool endpoints)`,
      );
      apiAdapter = new GenericHttpAdapter(
        {
          connectorId,
          baseUrl: connector.baseUrl,
          authType: connector.authType,
          authConfig,
          flows,
          oaVendor: connector.oaVendor || undefined,
          oaVersion: connector.oaVersion || undefined,
          oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
          healthCheckUrl: connector.healthCheckUrl || undefined,
        },
        this.endpointLoader,
      );
      if (hasLifecycle(apiAdapter) && apiAdapter.init) {
        await apiAdapter.init();
      }
    }

    return apiAdapter;
  }

  async createRpaAdapterForConnector(
    connectorId: string,
    flows?: Array<{ flowCode: string; flowName: string }>,
    authScope?: ExecutionAuthScope,
  ): Promise<RpaAdapter | null> {
    const connector = await this.getConnectorWithSecrets(connectorId);
    const authConfig = await this.resolveAuthConfigForExecution(connector, authScope);
    const rpaFlows = await this.loadRpaFlowsForConnector(connectorId, flows);
    if (rpaFlows.length === 0) {
      return null;
    }

    this.logger.log(`Using RpaAdapter for connector ${connectorId} (${rpaFlows.length} RPA flows)`);
    const rpaAdapter = new RpaAdapter(
      {
        connectorId,
        baseUrl: connector.baseUrl,
        authType: connector.authType,
        authConfig,
        authScope,
        oaVendor: connector.oaVendor || undefined,
        oaVersion: connector.oaVersion || undefined,
        oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
      },
      rpaFlows,
      this.platformTicketBroker,
      this.localRpaExecutor,
      this.browserRpaExecutor,
      this.oaBackendLoginService,
    );
    await rpaAdapter.init();
    return rpaAdapter;
  }

  async loadRpaFlowsForConnector(
    connectorId: string,
    flows?: Array<{ flowCode: string; flowName: string }>,
  ) {
    const loadedRpaFlows = await this.rpaFlowLoader.loadFlows(connectorId);
    const requestedFlowCodes = new Set((flows || []).map((flow) => flow.flowCode));
    return requestedFlowCodes.size > 0
      ? loadedRpaFlows.filter((flow) => requestedFlowCodes.has(flow.processCode))
      : loadedRpaFlows;
  }

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
    const baseConfig = { ...((connector.authConfig as Record<string, any>) || {}) };
    const secretRef = connector.secretRef;

    if (!secretRef) {
      return baseConfig;
    }

    const resolvedSecret = await this.resolveSecretPayload(
      connector.id,
      secretRef,
      connector.authType,
    );
    return this.mergeAuthConfig(baseConfig, resolvedSecret);
  }

  async resolveAuthConfigForExecution(
    connector: {
      id?: string;
      authType: string;
      authConfig: any;
      secretRef?: {
        secretProvider: string;
        secretPath: string;
        secretVersion?: string | null;
      } | null;
    },
    authScope?: ExecutionAuthScope,
  ) {
    const baseConfig = await this.resolveAuthConfig(connector);
    if (!connector.id || !authScope?.tenantId) {
      return baseConfig;
    }

    const binding = await this.authBindingService.resolveExecutionAuthConfig({
      tenantId: authScope.tenantId,
      connectorId: connector.id,
      userId: authScope.userId,
    });

    if (binding?.authConfig) {
      return this.mergeAuthConfig(baseConfig, binding.authConfig);
    }

    const delegated = await this.delegatedCredentialService.resolveExecutionAuthConfig({
      tenantId: authScope.tenantId,
      connectorId: connector.id,
      userId: authScope.userId,
      authType: connector.authType,
      baseAuthConfig: baseConfig,
    });

    if (!delegated?.authConfig) {
      if (!this.oaBackendLoginService) {
        return baseConfig;
      }

      const backendLogin = await this.oaBackendLoginService.resolveExecutionAuthConfig({
        connectorId: connector.id,
        authType: connector.authType,
        authConfig: baseConfig,
        authScope,
      });

      return backendLogin?.authConfig
        ? this.mergeAuthConfig(baseConfig, backendLogin.authConfig)
        : baseConfig;
    }

    return this.mergeAuthConfig(baseConfig, delegated.authConfig);
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
    const sensitive: Record<string, any> = Object.fromEntries(
      Object.entries(authConfig).filter(([key, value]) =>
        SENSITIVE_AUTH_KEYS.has(key) && value !== undefined && value !== null && value !== '',
      ),
    );

    const platformConfig = authConfig.platformConfig;
    if (platformConfig && typeof platformConfig === 'object' && !Array.isArray(platformConfig)) {
      const platformSecrets = Object.fromEntries(
        Object.entries(platformConfig as Record<string, any>).filter(([key, value]) =>
          SENSITIVE_AUTH_KEYS.has(key) && value !== undefined && value !== null && value !== '',
        ),
      );

      if (Object.keys(platformSecrets).length > 0) {
        sensitive.platformConfig = platformSecrets;
      }
    }

    return sensitive;
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

  private mergeAuthConfig(
    baseConfig: Record<string, any>,
    resolvedSecret: Record<string, any>,
  ) {
    const merged = {
      ...baseConfig,
      ...resolvedSecret,
    };

    const basePlatformConfig = baseConfig.platformConfig;
    const secretPlatformConfig = resolvedSecret.platformConfig;
    if (
      (basePlatformConfig && typeof basePlatformConfig === 'object' && !Array.isArray(basePlatformConfig))
      || (secretPlatformConfig && typeof secretPlatformConfig === 'object' && !Array.isArray(secretPlatformConfig))
    ) {
      merged.platformConfig = {
        ...((basePlatformConfig as Record<string, any> | undefined) || {}),
        ...((secretPlatformConfig as Record<string, any> | undefined) || {}),
      };
    }

    return merged;
  }
}
