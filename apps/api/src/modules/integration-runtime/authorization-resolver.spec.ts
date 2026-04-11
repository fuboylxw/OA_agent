import { AuthorizationResolver } from './authorization-resolver';

describe('AuthorizationResolver', () => {
  it('returns requires_user_action when delegated auth is selected without a usable binding', async () => {
    const resolver = new AuthorizationResolver();

    await expect(resolver.resolve({
      manifest: {
        provider: 'mock',
        version: '1.0.0',
        targets: ['oa'],
        capabilities: ['submit'],
        authChoices: [
          {
            id: 'delegated',
            mode: 'user',
            artifact: 'bearer_token',
            interactive: true,
            callback: 'oauth2',
          },
        ],
        routes: { submit: ['api'] },
      },
      capability: 'submit',
      authChoiceId: 'delegated',
      artifactResolver: async () => null,
    })).resolves.toEqual(expect.objectContaining({
      state: 'requires_user_action',
      authChoice: expect.objectContaining({ id: 'delegated' }),
    }));
  });

  it('returns ready when a non-interactive auth choice resolves an artifact', async () => {
    const resolver = new AuthorizationResolver();

    await expect(resolver.resolve({
      manifest: {
        provider: 'mock',
        version: '1.0.0',
        targets: ['oa'],
        capabilities: ['submit'],
        authChoices: [
          {
            id: 'service',
            mode: 'service',
            artifact: 'bearer_token',
            interactive: false,
          },
        ],
        routes: { submit: ['api'] },
      },
      capability: 'submit',
      artifactResolver: async () => ({
        type: 'bearer_token',
        payloadRef: 'inline',
        payload: { accessToken: 'token-1' },
      }),
    })).resolves.toEqual(expect.objectContaining({
      state: 'ready',
      artifact: expect.objectContaining({
        type: 'bearer_token',
        payload: expect.objectContaining({ accessToken: 'token-1' }),
      }),
    }));
  });
});
