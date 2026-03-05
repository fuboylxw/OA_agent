import { OCLLevel } from '@uniflow/shared-types';

// ============================================================
// OCL Calculator - Determines OA Compatibility Level
// ============================================================

export interface OCLInput {
  hasApi: boolean;
  hasOpenApi: boolean;
  hasAuth: boolean;
  canReadUsers: boolean;
  canReadFlows: boolean;
  canReadStatus: boolean;
  canSubmit: boolean;
  submitStable: boolean; // 近7天成功率>=98%
  hasCallback: boolean;
  hasRealtimePermission: boolean;
  hasIdempotent: boolean;
  canCancel: boolean;
  canUrge: boolean;
  canDelegate: boolean;
  canSupplement: boolean;
}

export interface OCLResult {
  level: OCLLevel;
  score: number;
  breakdown: OCLBreakdownItem[];
}

export interface OCLBreakdownItem {
  capability: string;
  available: boolean;
  weight: number;
  contribution: number;
}

export function calculateOCL(input: OCLInput): OCLResult {
  const breakdown: OCLBreakdownItem[] = [];
  let totalScore = 0;

  const checks: Array<{ capability: string; available: boolean; weight: number }> = [
    { capability: 'API Access', available: input.hasApi, weight: 10 },
    { capability: 'OpenAPI Spec', available: input.hasOpenApi, weight: 5 },
    { capability: 'Authentication', available: input.hasAuth, weight: 10 },
    { capability: 'Read Users', available: input.canReadUsers, weight: 10 },
    { capability: 'Read Flows', available: input.canReadFlows, weight: 10 },
    { capability: 'Read Status', available: input.canReadStatus, weight: 10 },
    { capability: 'Submit', available: input.canSubmit, weight: 15 },
    { capability: 'Submit Stability', available: input.submitStable, weight: 10 },
    { capability: 'Callback/Webhook', available: input.hasCallback, weight: 5 },
    { capability: 'Realtime Permission', available: input.hasRealtimePermission, weight: 5 },
    { capability: 'Idempotent Submit', available: input.hasIdempotent, weight: 5 },
    { capability: 'Cancel', available: input.canCancel, weight: 2 },
    { capability: 'Urge', available: input.canUrge, weight: 1 },
    { capability: 'Delegate', available: input.canDelegate, weight: 1 },
    { capability: 'Supplement', available: input.canSupplement, weight: 1 },
  ];

  for (const check of checks) {
    const contribution = check.available ? check.weight : 0;
    totalScore += contribution;
    breakdown.push({
      capability: check.capability,
      available: check.available,
      weight: check.weight,
      contribution,
    });
  }

  let level: OCLLevel;
  if (!input.hasApi && !input.hasAuth) {
    level = OCLLevel.OCL0;
  } else if (input.canReadUsers && input.canReadFlows && input.canReadStatus && !input.canSubmit) {
    level = OCLLevel.OCL1;
  } else if (input.canSubmit && !input.submitStable) {
    level = OCLLevel.OCL2;
  } else if (input.canSubmit && input.submitStable && !input.hasCallback) {
    level = OCLLevel.OCL3;
  } else if (input.canSubmit && input.submitStable && input.hasCallback && input.hasIdempotent) {
    if (input.canCancel && input.canUrge && input.canDelegate) {
      level = OCLLevel.OCL5;
    } else {
      level = OCLLevel.OCL4;
    }
  } else {
    level = totalScore >= 50 ? OCLLevel.OCL2 : totalScore >= 20 ? OCLLevel.OCL1 : OCLLevel.OCL0;
  }

  return { level, score: totalScore, breakdown };
}
