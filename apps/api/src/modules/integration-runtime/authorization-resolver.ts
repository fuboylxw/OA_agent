import type {
  AuthChoice,
  AuthorizationResolution,
  ResolveAuthorizationInput,
} from './types';

export class AuthorizationResolver {
  async resolve(input: ResolveAuthorizationInput): Promise<AuthorizationResolution> {
    const authChoice = this.selectAuthChoice(input);
    const artifact = await input.artifactResolver(authChoice);

    if (!artifact) {
      return {
        state: authChoice.interactive ? 'requires_user_action' : 'not_configured',
        authChoice,
      };
    }

    return {
      state: 'ready',
      authChoice,
      artifact,
    };
  }

  private selectAuthChoice(input: ResolveAuthorizationInput): AuthChoice {
    const requested = input.authChoiceId
      ? input.manifest.authChoices.find((choice) => choice.id === input.authChoiceId)
      : undefined;

    if (requested) {
      return requested;
    }

    const fallback = input.manifest.authChoices[0];
    if (!fallback) {
      throw new Error(`No auth choices available for capability "${input.capability}"`);
    }

    return fallback;
  }
}
