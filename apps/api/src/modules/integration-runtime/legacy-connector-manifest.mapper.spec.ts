import { LegacyConnectorManifestMapper } from './legacy-connector-manifest.mapper';

describe('LegacyConnectorManifestMapper', () => {
  it('maps delegated auth and hybrid routing into a single manifest', () => {
    const mapper = new LegacyConnectorManifestMapper();

    const manifest = mapper.mapConnector({
      id: 'connector-1',
      authType: 'oauth2',
      authConfig: {
        delegatedAuth: {
          enabled: true,
          provider: 'sso',
        },
        platformConfig: {
          ticketBrokerUrl: 'https://broker.example.com/tickets',
        },
      },
      capability: {
        supportsCancel: true,
        supportsRealtimePerm: true,
      },
      bootstrapMode: 'hybrid',
    } as any);

    expect(manifest).toEqual(expect.objectContaining({
      provider: 'legacy-connector',
      targets: ['oa'],
      capabilities: expect.arrayContaining(['submit', 'queryStatus', 'cancel', 'permission.check']),
      authChoices: expect.arrayContaining([
        expect.objectContaining({ id: 'service', mode: 'service', interactive: false }),
        expect.objectContaining({ id: 'delegated', mode: 'user', interactive: true, callback: 'oauth2' }),
      ]),
      routes: expect.objectContaining({
        submit: ['api', 'rpa'],
        queryStatus: ['api'],
      }),
    }));
  });
});
