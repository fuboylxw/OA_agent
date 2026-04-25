import { IntegrationRuntimeService } from './integration-runtime.service';

describe('IntegrationRuntimeService', () => {
  it('builds manifest routes from runtimeManifest when available', () => {
    const service = new IntegrationRuntimeService({} as any, {} as any);

    const manifest = service.buildManifest({
      id: 'connector-1',
      authType: 'cookie',
      authConfig: {},
      bootstrapMode: 'rpa_only',
      runtimeManifest: {
        version: 1,
        capabilities: {
          submit: ['url'],
          queryStatus: [],
        },
      },
    } as any);

    expect(manifest.routes).toEqual(expect.objectContaining({
      submit: ['url'],
    }));
  });
});
