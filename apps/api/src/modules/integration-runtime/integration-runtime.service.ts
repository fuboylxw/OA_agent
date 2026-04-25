import { Injectable } from '@nestjs/common';
import { AdapterRuntimeService, type ExecutionAuthScope } from '../adapter-runtime/adapter-runtime.service';
import { AuthBindingService } from '../auth-binding/auth-binding.service';
import { AuthorizationResolver } from './authorization-resolver';
import { ExistingAdapterProvider } from './existing-adapter-provider';
import { LegacyConnectorManifestMapper } from './legacy-connector-manifest.mapper';
import type { ProviderManifest } from './types';

interface ConnectorLike {
  id?: string;
  authType: string;
  authConfig: any;
  secretRef?: {
    secretProvider: string;
    secretPath: string;
    secretVersion?: string | null;
  } | null;
  capability?: Record<string, any> | null;
  bootstrapMode?: string | null;
  runtimeManifest?: Record<string, any> | null;
  uiHints?: Record<string, any> | null;
}

@Injectable()
export class IntegrationRuntimeService {
  private readonly mapper = new LegacyConnectorManifestMapper();
  private readonly authorizationResolver = new AuthorizationResolver();
  private readonly provider: ExistingAdapterProvider;

  constructor(
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly authBindingService: AuthBindingService,
  ) {
    this.provider = new ExistingAdapterProvider(adapterRuntimeService, authBindingService);
  }

  buildManifest(connector: ConnectorLike) {
    return this.mapper.mapConnector(connector);
  }

  async resolveConnectorExecutionAuth(input: {
    connector: ConnectorLike;
    capability: string;
    authChoiceId?: string;
    authScope?: ExecutionAuthScope;
  }) {
    const manifest = this.buildManifest(input.connector);
    const authChoiceId = input.authChoiceId || this.selectDefaultAuthChoiceId(manifest, input.authScope);
    const authorization = await this.authorizationResolver.resolve({
      manifest,
      capability: input.capability,
      authChoiceId,
      artifactResolver: (authChoice) => this.provider.resolveArtifact({
        connector: input.connector,
        authChoice,
        authScope: input.authScope,
      }),
    });

    return {
      manifest,
      ...authorization,
    };
  }

  private selectDefaultAuthChoiceId(
    manifest: ProviderManifest,
    authScope?: ExecutionAuthScope,
  ) {
    if (authScope?.tenantId && authScope.userId) {
      const userChoice = manifest.authChoices.find((choice) => choice.mode === 'user');
      if (userChoice) {
        return userChoice.id;
      }
    }

    return manifest.authChoices[0]?.id;
  }
}
