import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  AdapterFactory,
  AdapterRegistry,
  MockOAAdapter,
  TokenHeaderAdapter,
  CookieSessionAdapter,
  OAuth2RefreshAdapter,
  SoapXmlAdapter,
  MockDescriptor,
  TokenHeaderDescriptor,
  CookieSessionDescriptor,
  OAuth2RefreshDescriptor,
  SoapXmlDescriptor,
} from './index';
import type { AdapterDescriptor, AdapterConnectionConfig, OAAdapter } from './index';

describe('OA Adapters', () => {
  describe('MockOAAdapter', () => {
    let adapter: MockOAAdapter;

    beforeEach(() => {
      adapter = new MockOAAdapter({
        oaType: 'openapi',
        flows: [
          { flowCode: 'travel_expense', flowName: '差旅费报销' },
          { flowCode: 'leave_request', flowName: '请假申请' },
        ],
        simulateDelay: 10,
      });
    });

    it('should discover flows', async () => {
      const result = await adapter.discover();
      expect(result.oaVendor).toBe('MockOA');
      expect(result.oaType).toBe('openapi');
      expect(result.discoveredFlows.length).toBe(2);
      expect(result.discoveredFlows[0].flowCode).toBe('travel_expense');
    });

    it('should perform health check', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThan(0);
    });

    it('should submit successfully', async () => {
      const result = await adapter.submit({
        flowCode: 'travel_expense',
        formData: { amount: 1000, reason: 'test' },
        idempotencyKey: 'test-key',
      });
      expect(result.success).toBe(true);
      expect(result.submissionId).toBeDefined();
      expect(result.submissionId).toContain('MOCK-');
    });

    it('should query status', async () => {
      const result = await adapter.queryStatus('test-id');
      expect(result.status).toBe('pending');
      expect(result.statusDetail).toBeDefined();
      expect(result.timeline).toBeDefined();
      expect(result.timeline?.length).toBeGreaterThan(0);
    });

    it('should cancel submission', async () => {
      const result = await adapter.cancel!('test-id');
      expect(result.success).toBe(true);
      expect(result.message).toContain('cancelled');
    });

    it('should urge submission', async () => {
      const result = await adapter.urge!('test-id');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Urge sent');
    });

    it('should delegate submission', async () => {
      const result = await adapter.delegate!({
        submissionId: 'test-id',
        targetUserId: 'user-2',
        reason: 'test reason',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('delegated');
    });

    it('should supplement submission', async () => {
      const result = await adapter.supplement!({
        submissionId: 'test-id',
        supplementData: { additionalInfo: 'test' },
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Supplement added');
    });
  });

  describe('AdapterFactory', () => {
    it('should create mock adapter for openapi type', () => {
      const adapter = AdapterFactory.createMockAdapter('openapi', [
        { flowCode: 'test', flowName: 'Test Flow' },
      ]);
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(MockOAAdapter);
    });

    it('should create mock adapter for form-page type', () => {
      const adapter = AdapterFactory.createMockAdapter('form-page', []);
      expect(adapter).toBeDefined();
    });

    it('should create mock adapter for hybrid type', () => {
      const adapter = AdapterFactory.createMockAdapter('hybrid', []);
      expect(adapter).toBeDefined();
    });

    it('should create CookieSessionAdapter for cookie login based connectors', () => {
      const adapter = AdapterFactory.createAdapter({
        oaVendor: '学校OA系统',
        oaType: 'openapi',
        baseUrl: 'http://127.0.0.1:3210',
        authType: 'cookie',
        authConfig: {
          username: 'teacher',
          password: 'secret',
          loginPath: '/api/auth/login',
        },
      });
      expect(adapter).toBeInstanceOf(CookieSessionAdapter);
    });

    it('should create TokenHeaderAdapter for token-header auth config', () => {
      const adapter = AdapterFactory.createAdapter({
        oaVendor: 'O2OA',
        oaType: 'hybrid',
        baseUrl: 'http://localhost:20020',
        authType: 'apikey',
        authConfig: { headerName: 'x-token', apiKey: 'test-token' },
      });
      expect(adapter).toBeInstanceOf(TokenHeaderAdapter);
    });

    it('should create OAuth2RefreshAdapter for oauth2 with appKey', () => {
      const adapter = AdapterFactory.createAdapter({
        oaVendor: '钉钉OA',
        oaType: 'openapi',
        baseUrl: 'https://oapi.dingtalk.com',
        authType: 'oauth2',
        authConfig: { appKey: 'key', appSecret: 'secret' },
      });
      expect(adapter).toBeInstanceOf(OAuth2RefreshAdapter);
    });

    it('should create SoapXmlAdapter for SOAP endpoints', () => {
      const adapter = AdapterFactory.createAdapter({
        oaVendor: '泛微OA',
        oaType: 'hybrid',
        baseUrl: 'http://oa.example.com/services/WorkflowService',
        authType: 'basic',
        authConfig: { username: 'admin', password: 'pass', wsdlUrl: 'http://oa.example.com/services/WorkflowService?wsdl' },
      });
      expect(adapter).toBeInstanceOf(SoapXmlAdapter);
    });

    it('should fall back to MockOAAdapter for unknown vendor', () => {
      const adapter = AdapterFactory.createAdapter({
        oaVendor: 'unknown-vendor',
        oaType: 'openapi',
        baseUrl: 'http://example.com',
        authType: 'basic',
      });
      expect(adapter).toBeInstanceOf(MockOAAdapter);
    });

    it('should expose registry via getRegistry()', () => {
      const registry = AdapterFactory.getRegistry();
      expect(registry).toBeInstanceOf(AdapterRegistry);
      expect(registry.size).toBeGreaterThanOrEqual(5);
    });
  });

  describe('AdapterRegistry', () => {
    let registry: AdapterRegistry;

    beforeEach(() => {
      AdapterRegistry.resetInstance();
      registry = AdapterRegistry.getInstance();
    });

    afterEach(() => {
      AdapterRegistry.resetInstance();
    });

    it('should register and retrieve descriptors', () => {
      registry.register(TokenHeaderDescriptor);
      registry.register(CookieSessionDescriptor);
      expect(registry.size).toBe(2);
      expect(registry.get('token-header')).toBe(TokenHeaderDescriptor);
      expect(registry.get('cookie-session')).toBe(CookieSessionDescriptor);
    });

    it('should throw on duplicate registration', () => {
      registry.register(TokenHeaderDescriptor);
      expect(() => registry.register(TokenHeaderDescriptor)).toThrow(
        'Adapter "token-header" is already registered',
      );
    });

    it('should allow replace() for existing descriptors', () => {
      registry.register(TokenHeaderDescriptor);
      const custom = { ...TokenHeaderDescriptor, name: 'Custom Token Header' };
      registry.replace(custom);
      expect(registry.get('token-header')?.name).toBe('Custom Token Header');
      expect(registry.size).toBe(1);
    });

    it('should unregister descriptors', () => {
      registry.register(MockDescriptor);
      expect(registry.size).toBe(1);
      const removed = registry.unregister('mock');
      expect(removed).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should resolve best-matching descriptor by score', () => {
      registry.register(TokenHeaderDescriptor);
      registry.register(CookieSessionDescriptor);
      registry.register(OAuth2RefreshDescriptor);
      registry.register(SoapXmlDescriptor);
      registry.register(MockDescriptor);

      // Token header auth config → token-header (score 70)
      const tokenMatch = registry.resolve({
        oaVendor: 'O2OA',
        oaType: 'hybrid',
        baseUrl: 'http://localhost:20020',
        authType: 'apikey',
        authConfig: { headerName: 'x-token', apiKey: 'test-token' },
      });
      expect(tokenMatch?.id).toBe('token-header');

      // Cookie auth → cookie-session (score 90)
      const cookieMatch = registry.resolve({
        oaVendor: '学校OA',
        oaType: 'openapi',
        baseUrl: 'http://localhost:3210',
        authType: 'cookie',
      });
      expect(cookieMatch?.id).toBe('cookie-session');

      // OAuth2 with appKey → oauth2-refresh (score 90)
      const oauthMatch = registry.resolve({
        oaVendor: '钉钉',
        oaType: 'openapi',
        baseUrl: 'https://oapi.dingtalk.com',
        authType: 'oauth2',
        authConfig: { appKey: 'k', appSecret: 's' },
      });
      expect(oauthMatch?.id).toBe('oauth2-refresh');

      // SOAP endpoint → soap-xml (score 80)
      const soapMatch = registry.resolve({
        oaType: 'hybrid',
        baseUrl: 'http://oa.example.com/services/WorkflowService',
        authType: 'basic',
        authConfig: { wsdlUrl: 'http://oa.example.com/services/WorkflowService?wsdl' },
      });
      expect(soapMatch?.id).toBe('soap-xml');

      // Unknown → mock (score 1 fallback)
      const fallbackMatch = registry.resolve({
        oaVendor: 'unknown',
        oaType: 'openapi',
        baseUrl: 'http://example.com',
        authType: 'basic',
      });
      expect(fallbackMatch?.id).toBe('mock');
    });

    it('should return null when no descriptors match', () => {
      const result = registry.resolve({
        oaVendor: 'anything',
        oaType: 'openapi',
        baseUrl: 'http://example.com',
        authType: 'basic',
      });
      expect(result).toBeNull();
    });

    it('should create adapter via createAdapterSync', () => {
      registry.register(TokenHeaderDescriptor);
      registry.register(MockDescriptor);

      const adapter = registry.createAdapterSync({
        oaVendor: 'O2OA',
        oaType: 'hybrid',
        baseUrl: 'http://localhost:20020',
        authType: 'apikey',
        authConfig: { headerName: 'x-token', apiKey: 'test' },
      });
      expect(adapter).toBeInstanceOf(TokenHeaderAdapter);
    });

    it('should throw when no adapter matches in createAdapterSync', () => {
      expect(() =>
        registry.createAdapterSync({
          oaVendor: 'unknown',
          oaType: 'openapi',
          baseUrl: 'http://example.com',
          authType: 'basic',
        }),
      ).toThrow('No registered adapter matches');
    });

    it('should list all registered ids', () => {
      registry.register(TokenHeaderDescriptor);
      registry.register(CookieSessionDescriptor);
      registry.register(OAuth2RefreshDescriptor);
      registry.register(SoapXmlDescriptor);
      registry.register(MockDescriptor);

      const ids = registry.listIds();
      expect(ids).toContain('token-header');
      expect(ids).toContain('cookie-session');
      expect(ids).toContain('oauth2-refresh');
      expect(ids).toContain('soap-xml');
      expect(ids).toContain('mock');
    });

    it('should return capabilities for a registered adapter', () => {
      registry.register(TokenHeaderDescriptor);
      const caps = registry.getCapabilities('token-header');
      expect(caps).toBeDefined();
      expect(caps!.supportsDiscovery).toBe(true);
      expect(caps!.supportsSubmit).toBe(true);
      expect(caps!.supportsDelegate).toBe(false);
    });

    it('should support registering a custom third-party adapter', () => {
      const customDescriptor: AdapterDescriptor = {
        id: 'custom-graphql',
        name: 'GraphQL OA Adapter',
        vendor: 'GraphQL',
        authTypes: ['oauth2'],
        capabilities: {
          supportsDiscovery: true,
          supportsSubmit: true,
          supportsStatusQuery: true,
          supportsReferenceData: true,
          supportsCancel: false,
          supportsUrge: false,
          supportsDelegate: false,
          supportsSupplement: false,
          supportsWebhook: true,
        },
        match(config: AdapterConnectionConfig): number {
          const vendor = (config.oaVendor || '').toLowerCase();
          if (vendor.includes('graphql')) return 90;
          if (config.baseUrl.includes('/graphql')) return 85;
          return 0;
        },
        create(config: AdapterConnectionConfig): OAAdapter {
          return new MockOAAdapter({
            oaType: config.oaType,
            flows: config.flows || [],
          });
        },
      };

      registry.register(customDescriptor);
      expect(registry.size).toBe(1);

      const match = registry.resolve({
        oaVendor: 'GraphQL OA',
        oaType: 'openapi',
        baseUrl: 'https://oa.example.com/graphql',
        authType: 'oauth2',
      });
      expect(match?.id).toBe('custom-graphql');
      expect(match?.capabilities.supportsWebhook).toBe(true);
    });
  });
});
