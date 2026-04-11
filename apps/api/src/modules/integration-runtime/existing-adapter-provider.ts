import { AdapterRuntimeService, type ExecutionAuthScope } from '../adapter-runtime/adapter-runtime.service';
import { AuthBindingService } from '../auth-binding/auth-binding.service';
import type {
  AuthArtifact,
  AuthChoice,
  AuthArtifactType,
} from './types';

interface ConnectorLike {
  id?: string;
  authType: string;
  authConfig: any;
  secretRef?: {
    secretProvider: string;
    secretPath: string;
    secretVersion?: string | null;
  } | null;
}

export class ExistingAdapterProvider {
  constructor(
    private readonly adapterRuntimeService: Pick<AdapterRuntimeService, 'resolveAuthConfig' | 'resolveAuthConfigForExecution'>,
    private readonly authBindingService: Pick<AuthBindingService, 'hasUsableBinding'>,
  ) {}

  async resolveArtifact(input: {
    connector: ConnectorLike;
    authChoice: AuthChoice;
    authScope?: ExecutionAuthScope;
  }): Promise<AuthArtifact | null> {
    if (input.authChoice.mode === 'user') {
      if (!input.connector.id || !input.authScope?.tenantId || !input.authScope.userId) {
        return null;
      }

      const delegatedEnabled = this.readDelegatedAuthEnabled(input.connector.authConfig);
      if (delegatedEnabled) {
        const bindingStatus = await this.authBindingService.hasUsableBinding({
          tenantId: input.authScope.tenantId,
          connectorId: input.connector.id,
          userId: input.authScope.userId,
        });
        if (!bindingStatus.authorized) {
          return null;
        }
      }

      const resolved = await this.adapterRuntimeService.resolveAuthConfigForExecution(
        input.connector,
        input.authScope,
      );
      return this.mapAuthConfigToArtifact(input.authChoice.artifact, resolved);
    }

    const resolved = await this.adapterRuntimeService.resolveAuthConfig(input.connector);
    return this.mapAuthConfigToArtifact(input.authChoice.artifact, resolved);
  }

  private mapAuthConfigToArtifact(
    artifactType: AuthArtifactType,
    authConfig: Record<string, any> | null | undefined,
  ): AuthArtifact | null {
    const payload = authConfig && typeof authConfig === 'object' && !Array.isArray(authConfig)
      ? authConfig
      : {};

    switch (artifactType) {
      case 'bearer_token':
        if (!payload.accessToken && !payload.token) {
          return null;
        }
        break;
      case 'api_key':
        if (!payload.token && !payload.apiKey) {
          return null;
        }
        break;
      case 'basic_credential':
        if (!payload.username || !payload.password) {
          return null;
        }
        break;
      case 'cookie_jar':
        if (!payload.cookie && !payload.sessionCookie) {
          return null;
        }
        break;
      case 'jump_ticket':
        if (!payload.platformConfig || typeof payload.platformConfig !== 'object') {
          return null;
        }
        break;
      default:
        if (Object.keys(payload).length === 0) {
          return null;
        }
        break;
    }

    return {
      type: artifactType,
      payloadRef: 'inline',
      payload,
    };
  }

  private readDelegatedAuthEnabled(authConfig: unknown) {
    if (!authConfig || typeof authConfig !== 'object' || Array.isArray(authConfig)) {
      return false;
    }

    const delegatedAuth = (authConfig as Record<string, any>).delegatedAuth;
    return Boolean(
      delegatedAuth
      && typeof delegatedAuth === 'object'
      && !Array.isArray(delegatedAuth)
      && delegatedAuth.enabled === true,
    );
  }
}
