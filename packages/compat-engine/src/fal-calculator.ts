import { FALLevel } from '@uniflow/shared-types';

// ============================================================
// FAL Calculator - Determines Flow Automation Level
// ============================================================

export interface FALInput {
  oclLevel: string; // OCL0-OCL5
  permissionGatePassed: boolean; // G1
  fieldCoverage: number; // G2: 必填字段覆盖率
  ruleCoverage: number; // G3: 可执行规则覆盖率
  recentSubmitSuccessRate: number; // G4: 近7天提交成功率
  auditCompleteness: number; // G5: 关键事件审计完整率
}

export interface FALResult {
  level: FALLevel;
  gates: GateResult[];
  canAutoSubmit: boolean;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  value: number | boolean;
  threshold: number | boolean;
  description: string;
}

export function calculateFAL(input: FALInput): FALResult {
  const gates: GateResult[] = [
    {
      gate: 'G1_PERMISSION',
      passed: input.permissionGatePassed,
      value: input.permissionGatePassed,
      threshold: true,
      description: '平台权限 + OA实时权限通过',
    },
    {
      gate: 'G2_TEMPLATE',
      passed: input.fieldCoverage >= 0.95,
      value: input.fieldCoverage,
      threshold: 0.95,
      description: '必填字段覆盖率 >= 95%',
    },
    {
      gate: 'G3_RULE',
      passed: input.ruleCoverage >= 0.90,
      value: input.ruleCoverage,
      threshold: 0.90,
      description: '可执行规则覆盖率 >= 90%',
    },
    {
      gate: 'G4_CHANNEL',
      passed: input.recentSubmitSuccessRate >= 0.98,
      value: input.recentSubmitSuccessRate,
      threshold: 0.98,
      description: '近7天提交成功率 >= 98%',
    },
    {
      gate: 'G5_AUDIT',
      passed: input.auditCompleteness >= 1.0,
      value: input.auditCompleteness,
      threshold: 1.0,
      description: '关键事件审计完整率 = 100%',
    },
  ];

  const allGatesPassed = gates.every(g => g.passed);
  const oclNum = parseInt(input.oclLevel.replace('OCL', ''), 10);

  let level: FALLevel;
  if (oclNum <= 0) {
    level = FALLevel.F0;
  } else if (oclNum === 1) {
    level = FALLevel.F1;
  } else if (!allGatesPassed || oclNum === 2) {
    level = FALLevel.F2;
  } else if (oclNum >= 3 && allGatesPassed) {
    level = oclNum >= 5 ? FALLevel.F4 : FALLevel.F3;
  } else {
    level = FALLevel.F2;
  }

  return {
    level,
    gates,
    canAutoSubmit: level >= FALLevel.F3,
  };
}
