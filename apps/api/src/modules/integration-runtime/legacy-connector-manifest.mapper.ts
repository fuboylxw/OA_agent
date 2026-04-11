import {
  AuthArtifactType,
  type AuthChoice,
  type ProviderManifest,
  type RouteKind,
} from './types';

const DEFAULT_CAPABILITIES = ['submit', 'queryStatus'] as const;

export class LegacyConnectorManifestMapper {
  mapConnector(connector: {
    id?: string;
    authType?: string | null;
    authConfig?: Record<string, any> | null;
    capability?: Record<string, any> | null;
    bootstrapMode?: string | null;
  }): ProviderManifest {
    const authConfig = this.asRecord(connector.authConfig);
    const delegatedAuth = this.asRecord(authConfig.delegatedAuth);
    const platformConfig = this.asRecord(authConfig.platformConfig);
    const capability = this.asRecord(connector.capability);

    const capabilities = new Set<string>(DEFAULT_CAPABILITIES);
    if (capability.supportsCancel) capabilities.add('cancel');
    if (capability.supportsUrge) capabilities.add('urge');
    if (capability.supportsDelegate) capabilities.add('delegate');
    if (capability.supportsSupplement) capabilities.add('supplement');
    if (capability.supportsReferenceSync || capability.supportsSchemaSync) capabilities.add('sync');
    if (capability.supportsRealtimePerm) capabilities.add('permission.check');

    const routes = this.buildRoutes(connector.bootstrapMode);
    const authChoices: AuthChoice[] = [
      {
        id: 'service',
        mode: 'service' as const,
        artifact: this.mapArtifactType(connector.authType),
        interactive: false,
      },
    ];

    if (delegatedAuth.enabled === true) {
      authChoices.push({
        id: 'delegated',
        mode: 'user' as const,
        artifact: 'bearer_token',
        interactive: true,
        callback: 'oauth2' as const,
      });
    }

    if (platformConfig.ticketBrokerUrl || platformConfig.jumpUrlTemplate) {
      authChoices.push({
        id: 'platform_ticket',
        mode: 'user' as const,
        artifact: 'jump_ticket',
        interactive: true,
        callback: 'broker' as const,
      });
    }

    return {
      provider: 'legacy-connector',
      version: '1.0.0',
      targets: ['oa'],
      capabilities: [...capabilities],
      authChoices,
      routes,
      uiHints: {
        connectorId: connector.id,
      },
    };
  }

  private buildRoutes(bootstrapMode?: string | null): Partial<Record<'submit' | 'queryStatus', RouteKind[]>> {
    if (bootstrapMode === 'rpa_only') {
      return {
        submit: ['rpa'],
        queryStatus: ['rpa'],
      };
    }

    if (bootstrapMode === 'hybrid') {
      return {
        submit: ['api', 'rpa'],
        queryStatus: ['api'],
      };
    }

    return {
      submit: ['api'],
      queryStatus: ['api'],
    };
  }

  private mapArtifactType(authType?: string | null): AuthArtifactType {
    switch (String(authType || '').toLowerCase()) {
      case 'oauth2':
      case 'bearer':
        return 'bearer_token';
      case 'apikey':
        return 'api_key';
      case 'basic':
        return 'basic_credential';
      case 'cookie':
        return 'cookie_jar';
      default:
        return 'unknown';
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }
}
