import { MockOAAdapter, AdapterFactory } from '../index';

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
  });
});
