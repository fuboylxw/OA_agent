// ============================================================
// OA Adapter Interface
// ============================================================

export interface OAAdapter {
  discover(): Promise<DiscoverResult>;
  healthCheck(): Promise<HealthCheckResult>;
  submit(request: SubmitRequest): Promise<SubmitResult>;
  queryStatus(submissionId: string): Promise<StatusResult>;
  cancel?(submissionId: string): Promise<CancelResult>;
  urge?(submissionId: string): Promise<UrgeResult>;
  delegate?(request: DelegateRequest): Promise<DelegateResult>;
  supplement?(request: SupplementRequest): Promise<SupplementResult>;
}

export interface DiscoverResult {
  oaVendor: string;
  oaVersion?: string;
  oaType: 'openapi' | 'form-page' | 'hybrid';
  authType: 'oauth2' | 'basic' | 'apikey' | 'cookie';
  discoveredFlows: Array<{
    flowCode: string;
    flowName: string;
    entryUrl?: string;
    submitUrl?: string;
    queryUrl?: string;
  }>;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface SubmitRequest {
  flowCode: string;
  formData: Record<string, any>;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface SubmitResult {
  success: boolean;
  submissionId?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface StatusResult {
  status: string;
  statusDetail?: Record<string, any>;
  timeline?: Array<{
    timestamp: string;
    status: string;
    operator?: string;
    comment?: string;
  }>;
}

export interface CancelResult {
  success: boolean;
  message?: string;
}

export interface UrgeResult {
  success: boolean;
  message?: string;
}

export interface DelegateRequest {
  submissionId: string;
  targetUserId: string;
  reason?: string;
}

export interface DelegateResult {
  success: boolean;
  message?: string;
}

export interface SupplementRequest {
  submissionId: string;
  supplementData: Record<string, any>;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface SupplementResult {
  success: boolean;
  message?: string;
}

// ============================================================
// Mock OA Adapter Factory
// ============================================================

export class MockOAAdapter implements OAAdapter {
  constructor(
    private readonly config: {
      oaType: 'openapi' | 'form-page' | 'hybrid';
      flows: Array<{ flowCode: string; flowName: string }>;
      simulateDelay?: number;
    },
  ) {}

  async discover(): Promise<DiscoverResult> {
    await this.delay();
    return {
      oaVendor: 'MockOA',
      oaVersion: '1.0.0',
      oaType: this.config.oaType,
      authType: 'apikey',
      discoveredFlows: this.config.flows.map(f => ({
        flowCode: f.flowCode,
        flowName: f.flowName,
        entryUrl: `/flows/${f.flowCode}`,
        submitUrl: `/flows/${f.flowCode}/submit`,
        queryUrl: `/flows/${f.flowCode}/status`,
      })),
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    await this.delay();
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      message: 'Mock OA is healthy',
    };
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.delay();
    const mockId = `MOCK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return {
      success: true,
      submissionId: mockId,
      metadata: {
        flowCode: request.flowCode,
        submittedAt: new Date().toISOString(),
      },
    };
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.delay();
    return {
      status: 'pending',
      statusDetail: {
        currentStep: 'manager_approval',
        currentApprover: 'mock_manager',
      },
      timeline: [
        {
          timestamp: new Date().toISOString(),
          status: 'submitted',
          operator: 'system',
          comment: 'Application submitted',
        },
      ],
    };
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    await this.delay();
    return {
      success: true,
      message: `Submission ${submissionId} cancelled`,
    };
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    await this.delay();
    return {
      success: true,
      message: `Urge sent for submission ${submissionId}`,
    };
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    await this.delay();
    return {
      success: true,
      message: `Submission ${request.submissionId} delegated to ${request.targetUserId}`,
    };
  }

  async supplement(request: SupplementRequest): Promise<SupplementResult> {
    await this.delay();
    return {
      success: true,
      message: `Supplement added to submission ${request.submissionId}`,
    };
  }

  private async delay(): Promise<void> {
    if (this.config.simulateDelay) {
      await new Promise(resolve => setTimeout(resolve, this.config.simulateDelay));
    }
  }
}

// ============================================================
// Adapter Factory
// ============================================================

export class AdapterFactory {
  static createMockAdapter(
    oaType: 'openapi' | 'form-page' | 'hybrid',
    flows: Array<{ flowCode: string; flowName: string }>,
  ): OAAdapter {
    return new MockOAAdapter({ oaType, flows, simulateDelay: 100 });
  }
}

// Export O2OA adapter
export { O2OAAdapter, type O2OAConfig } from './o2oa-adapter';
