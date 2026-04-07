import { calculateOCL } from './ocl-calculator';
import { OCLLevel } from '@uniflow/shared-types';

describe('OCL Calculator', () => {
  it('should return OCL0 for no API access', () => {
    const result = calculateOCL({
      hasApi: false,
      hasOpenApi: false,
      hasAuth: false,
      canReadUsers: false,
      canReadFlows: false,
      canReadStatus: false,
      canSubmit: false,
      submitStable: false,
      hasCallback: false,
      hasRealtimePermission: false,
      hasIdempotent: false,
      canCancel: false,
      canUrge: false,
      canDelegate: false,
      canSupplement: false,
    });

    expect(result.level).toBe(OCLLevel.OCL0);
  });

  it('should return OCL1 for read-only access', () => {
    const result = calculateOCL({
      hasApi: true,
      hasOpenApi: false,
      hasAuth: true,
      canReadUsers: true,
      canReadFlows: true,
      canReadStatus: true,
      canSubmit: false,
      submitStable: false,
      hasCallback: false,
      hasRealtimePermission: false,
      hasIdempotent: false,
      canCancel: false,
      canUrge: false,
      canDelegate: false,
      canSupplement: false,
    });

    expect(result.level).toBe(OCLLevel.OCL1);
  });

  it('should return OCL3 for stable submission', () => {
    const result = calculateOCL({
      hasApi: true,
      hasOpenApi: true,
      hasAuth: true,
      canReadUsers: true,
      canReadFlows: true,
      canReadStatus: true,
      canSubmit: true,
      submitStable: true,
      hasCallback: false,
      hasRealtimePermission: false,
      hasIdempotent: false,
      canCancel: false,
      canUrge: false,
      canDelegate: false,
      canSupplement: false,
    });

    expect(result.level).toBe(OCLLevel.OCL3);
  });

  it('should return OCL5 for full lifecycle support', () => {
    const result = calculateOCL({
      hasApi: true,
      hasOpenApi: true,
      hasAuth: true,
      canReadUsers: true,
      canReadFlows: true,
      canReadStatus: true,
      canSubmit: true,
      submitStable: true,
      hasCallback: true,
      hasRealtimePermission: true,
      hasIdempotent: true,
      canCancel: true,
      canUrge: true,
      canDelegate: true,
      canSupplement: true,
    });

    expect(result.level).toBe(OCLLevel.OCL5);
  });
});
