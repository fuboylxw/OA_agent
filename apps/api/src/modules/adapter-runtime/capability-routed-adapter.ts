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
} from '@uniflow/oa-adapters';
import type { LoadedRpaFlow } from './prisma-rpa-flow-loader';

export class CapabilityRoutedAdapter implements OAAdapter {
  constructor(
    private readonly apiAdapter: OAAdapter | null,
    private readonly rpaAdapter: OAAdapter | null,
    private readonly rpaFlows: LoadedRpaFlow[],
  ) {}

  async discover(): Promise<DiscoverResult> {
    if (this.apiAdapter) {
      return this.apiAdapter.discover();
    }
    if (this.rpaAdapter) {
      return this.rpaAdapter.discover();
    }
    throw new Error('No adapter configured');
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const apiHealth = this.apiAdapter ? await this.apiAdapter.healthCheck() : null;
    if (apiHealth?.healthy) {
      return apiHealth;
    }

    if (this.rpaAdapter) {
      return this.rpaAdapter.healthCheck();
    }

    return apiHealth || { healthy: false, latencyMs: 0, message: 'No adapter configured' };
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    const flow = this.rpaFlows.find((item) => item.processCode === request.flowCode);
    const submitModes = flow?.executionModes.submit || [];

    if (this.apiAdapter && submitModes.includes('api')) {
      return this.apiAdapter.submit(request);
    }

    if (this.rpaAdapter && submitModes.includes('rpa')) {
      return this.rpaAdapter.submit(request);
    }

    if (this.apiAdapter) {
      return this.apiAdapter.submit(request);
    }

    if (this.rpaAdapter) {
      return this.rpaAdapter.submit(request);
    }

    return { success: false, errorMessage: 'No adapter available for submit' };
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    const hasApiStatus = this.rpaFlows.some((flow) => flow.executionModes.queryStatus.includes('api'));
    const hasRpaStatus = this.rpaFlows.some((flow) => flow.executionModes.queryStatus.includes('rpa'));

    if (this.apiAdapter && hasApiStatus) {
      return this.apiAdapter.queryStatus(submissionId);
    }

    if (this.rpaAdapter && hasRpaStatus) {
      return this.rpaAdapter.queryStatus(submissionId);
    }

    if (this.apiAdapter) {
      return this.apiAdapter.queryStatus(submissionId);
    }

    if (this.rpaAdapter) {
      return this.rpaAdapter.queryStatus(submissionId);
    }

    return { status: 'error', statusDetail: { error: 'No adapter available for status query' } };
  }

  async listReferenceData(datasetCode: string): Promise<ReferenceDataResult> {
    if (this.apiAdapter?.listReferenceData) {
      return this.apiAdapter.listReferenceData(datasetCode);
    }
    throw new Error('Reference data is not configured');
  }

  async cancel(submissionId: string): Promise<CancelResult> {
    if (this.apiAdapter?.cancel) {
      return this.apiAdapter.cancel(submissionId);
    }
    if (this.rpaAdapter?.cancel) {
      return this.rpaAdapter.cancel(submissionId);
    }
    return { success: false, message: 'Cancel is not configured' };
  }

  async urge(submissionId: string): Promise<UrgeResult> {
    if (this.apiAdapter?.urge) {
      return this.apiAdapter.urge(submissionId);
    }
    if (this.rpaAdapter?.urge) {
      return this.rpaAdapter.urge(submissionId);
    }
    return { success: false, message: 'Urge is not configured' };
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    if (this.apiAdapter?.delegate) {
      return this.apiAdapter.delegate(request);
    }
    if (this.rpaAdapter?.delegate) {
      return this.rpaAdapter.delegate(request);
    }
    return { success: false, message: 'Delegate is not configured' };
  }

  async supplement(request: SupplementRequest): Promise<SupplementResult> {
    if (this.apiAdapter?.supplement) {
      return this.apiAdapter.supplement(request);
    }
    if (this.rpaAdapter?.supplement) {
      return this.rpaAdapter.supplement(request);
    }
    return { success: false, message: 'Supplement is not configured' };
  }
}
