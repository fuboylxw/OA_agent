import { calculateFAL } from './fal-calculator';
import { FALLevel } from '@uniflow/shared-types';

describe('FAL Calculator', () => {
  it('should return F0 for OCL0', () => {
    const result = calculateFAL({
      oclLevel: 'OCL0',
      permissionGatePassed: false,
      fieldCoverage: 0,
      ruleCoverage: 0,
      recentSubmitSuccessRate: 0,
      auditCompleteness: 0,
    });

    expect(result.level).toBe(FALLevel.F0);
    expect(result.canAutoSubmit).toBe(false);
  });

  it('should return F1 for OCL1', () => {
    const result = calculateFAL({
      oclLevel: 'OCL1',
      permissionGatePassed: true,
      fieldCoverage: 0.8,
      ruleCoverage: 0.8,
      recentSubmitSuccessRate: 0.9,
      auditCompleteness: 1.0,
    });

    expect(result.level).toBe(FALLevel.F1);
    expect(result.canAutoSubmit).toBe(false);
  });

  it('should return F2 when gates fail', () => {
    const result = calculateFAL({
      oclLevel: 'OCL3',
      permissionGatePassed: false,
      fieldCoverage: 0.9,
      ruleCoverage: 0.85,
      recentSubmitSuccessRate: 0.95,
      auditCompleteness: 1.0,
    });

    expect(result.level).toBe(FALLevel.F2);
    expect(result.canAutoSubmit).toBe(false);
  });

  it('should return F3 when all gates pass', () => {
    const result = calculateFAL({
      oclLevel: 'OCL3',
      permissionGatePassed: true,
      fieldCoverage: 0.96,
      ruleCoverage: 0.92,
      recentSubmitSuccessRate: 0.99,
      auditCompleteness: 1.0,
    });

    expect(result.level).toBe(FALLevel.F3);
    expect(result.canAutoSubmit).toBe(true);
    expect(result.gates.every(g => g.passed)).toBe(true);
  });

  it('should return F4 for OCL5 with all gates', () => {
    const result = calculateFAL({
      oclLevel: 'OCL5',
      permissionGatePassed: true,
      fieldCoverage: 0.98,
      ruleCoverage: 0.95,
      recentSubmitSuccessRate: 0.99,
      auditCompleteness: 1.0,
    });

    expect(result.level).toBe(FALLevel.F4);
    expect(result.canAutoSubmit).toBe(true);
  });

  it('should provide gate details', () => {
    const result = calculateFAL({
      oclLevel: 'OCL3',
      permissionGatePassed: true,
      fieldCoverage: 0.90,
      ruleCoverage: 0.85,
      recentSubmitSuccessRate: 0.95,
      auditCompleteness: 1.0,
    });

    expect(result.gates.length).toBe(5);
    expect(result.gates[0].gate).toBe('G1_PERMISSION');
    expect(result.gates[1].gate).toBe('G2_TEMPLATE');

    const failedGate = result.gates.find(g => !g.passed);
    if (failedGate) {
      expect(failedGate.description).toBeDefined();
    }
  });
});
