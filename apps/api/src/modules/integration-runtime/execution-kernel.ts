import { AuthorizationResolver } from './authorization-resolver';
import type {
  ExecuteIntegrationInput,
  ExecutionResult,
  IntegrationRouteKind,
} from './types';

export class ExecutionKernel {
  constructor(
    private readonly authorizationResolver = new AuthorizationResolver(),
  ) {}

  async execute(input: ExecuteIntegrationInput): Promise<ExecutionResult> {
    const authorization = await this.authorizationResolver.resolve({
      manifest: input.manifest,
      capability: input.capability,
      authChoiceId: input.authChoiceId,
      artifactResolver: (authChoice) => input.provider.resolveArtifact({
        manifest: input.manifest,
        capability: input.capability,
        authChoice,
        input: input.input,
        authScope: input.authScope,
      }),
    });

    if (!authorization.artifact) {
      return {
        status: 'awaiting_authorization',
        authorization,
      };
    }

    const route = this.selectRoute(input.capability, input.manifest.routes);
    const raw = await input.provider.execute({
      manifest: input.manifest,
      capability: input.capability,
      route,
      authChoice: authorization.authChoice,
      artifact: authorization.artifact,
      input: input.input,
      authScope: input.authScope,
    });

    return input.provider.normalize(raw);
  }

  private selectRoute(
    capability: string,
    routes: Partial<Record<string, IntegrationRouteKind[]>>,
  ): IntegrationRouteKind {
    const route = routes[capability]?.[0];
    if (!route) {
      throw new Error(`No route configured for capability "${capability}"`);
    }
    return route;
  }
}
