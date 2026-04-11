import { ExecutionKernel } from './execution-kernel';

describe('ExecutionKernel', () => {
  it('executes through the selected provider and normalizes the result', async () => {
    const kernel = new ExecutionKernel();

    const result = await kernel.execute({
      manifest: {
        provider: 'mock',
        version: '1.0.0',
        targets: ['oa'],
        capabilities: ['queryStatus'],
        authChoices: [
          {
            id: 'service',
            mode: 'service',
            artifact: 'bearer_token',
            interactive: false,
          },
        ],
        routes: {
          queryStatus: ['api'],
        },
      },
      capability: 'queryStatus',
      input: { submissionId: 'oa-1' },
      provider: {
        resolveArtifact: async () => ({
          type: 'bearer_token',
          payloadRef: 'inline',
          payload: { accessToken: 'token' },
        }),
        execute: async () => ({ status: 'approved' }),
        normalize: async (raw: unknown) => ({
          status: 'succeeded',
          data: raw,
        }),
      } as any,
    });

    expect(result).toEqual({
      status: 'succeeded',
      data: { status: 'approved' },
    });
  });

  it('returns awaiting_authorization when the selected auth choice is interactive and unresolved', async () => {
    const kernel = new ExecutionKernel();

    const result = await kernel.execute({
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
        routes: {
          submit: ['api'],
        },
      },
      capability: 'submit',
      input: { flowCode: 'leave' },
      provider: {
        resolveArtifact: async () => null,
      } as any,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'awaiting_authorization',
      authorization: expect.objectContaining({
        state: 'requires_user_action',
      }),
    }));
  });
});
