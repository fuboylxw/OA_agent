jest.mock('../agents/api-analyzer.agent', () => ({
  ApiAnalyzerAgent: class MockApiAnalyzerAgent {},
}));

jest.mock('../agents/bootstrap-repair.agent', () => ({
  BootstrapRepairAgent: class MockBootstrapRepairAgent {},
}));

jest.mock('@uniflow/agent-kernel', () => ({
  recordRuntimeDiagnostic: jest.fn(),
}));

import { normalizeProcessName } from '@uniflow/shared-types';
import { BootstrapProcessor } from './bootstrap.processor';

describe('generic runtime behavior', () => {
  it('humanizes process codes without built-in business translation tables', () => {
    expect(normalizeProcessName({ processCode: 'leave_request_form' })).toBe('Leave Request');
    expect(normalizeProcessName({ processCode: 'workflow_purchase_approval' })).toBe('Purchase Approval');
    expect(normalizeProcessName({ processCode: 'expense_submission' })).toBe('Expense');
  });

  it('does not inject business-specific default samples for type-like fields', () => {
    const processor = new BootstrapProcessor({} as any);

    expect((processor as any).buildNamedStringSample('leave_type')).toBeUndefined();
    expect((processor as any).buildNamedStringSample('expense_type')).toBeUndefined();
    expect((processor as any).buildNamedStringSample('vehicle_type')).toBeUndefined();
    expect((processor as any).buildNamedStringSample('contact_phone')).toBe('13800138000');
  });
});
