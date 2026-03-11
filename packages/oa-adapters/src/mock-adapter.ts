import type {
  OAAdapter,
  DiscoverResult,
  HealthCheckResult,
  SubmitRequest,
  SubmitResult,
  StatusResult,
  ReferenceDataResult,
  CancelResult,
  UrgeResult,
  DelegateRequest,
  DelegateResult,
  SupplementRequest,
  SupplementResult,
} from './index';

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

  async queryStatus(_submissionId: string): Promise<StatusResult> {
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

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    await this.delay();
    return {
      datasetCode,
      datasetName: datasetCode,
      datasetType: datasetCode,
      syncMode: 'ttl',
      items: [],
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
