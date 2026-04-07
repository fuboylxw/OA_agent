export interface ProcessNameNormalizationInput {
  processName?: string | null;
  processCode?: string | null;
}

type DirectProcessNameRule = {
  processName: string;
  requiredTokens: string[];
};

const DIRECT_PROCESS_NAME_RULES: DirectProcessNameRule[] = [
  { processName: '差旅费报销', requiredTokens: ['travel', 'expense'] },
  { processName: '会议室预约', requiredTokens: ['meeting', 'room'] },
  { processName: '请假申请', requiredTokens: ['leave'] },
  { processName: '费用报销', requiredTokens: ['expense'] },
  { processName: '发票申请', requiredTokens: ['invoice'] },
  { processName: '付款申请', requiredTokens: ['payment'] },
  { processName: '财务申请', requiredTokens: ['finance'] },
  { processName: '采购申请', requiredTokens: ['purchase'] },
  { processName: '差旅申请', requiredTokens: ['travel'] },
  { processName: '用车申请', requiredTokens: ['vehicle'] },
  { processName: '会议预约', requiredTokens: ['meeting'] },
  { processName: '加班申请', requiredTokens: ['overtime'] },
  { processName: '考勤申请', requiredTokens: ['attendance'] },
  { processName: '用印申请', requiredTokens: ['seal'] },
];

const GENERIC_SUFFIX_TOKENS = new Set([
  'application',
  'apply',
  'approval',
  'approvals',
  'book',
  'booking',
  'flow',
  'flows',
  'form',
  'forms',
  'process',
  'request',
  'requests',
  'submission',
  'submit',
  'type',
  'types',
  'workflow',
  'workflows',
]);

const TOKEN_ALIASES = new Map<string, string>([
  ['absence', 'leave'],
  ['applications', 'application'],
  ['applys', 'apply'],
  ['approvals', 'approval'],
  ['bookings', 'booking'],
  ['car', 'vehicle'],
  ['cars', 'vehicle'],
  ['conference', 'meeting'],
  ['conferences', 'meeting'],
  ['contracts', 'contract'],
  ['expenses', 'expense'],
  ['finances', 'finance'],
  ['flows', 'flow'],
  ['forms', 'form'],
  ['invoices', 'invoice'],
  ['leaves', 'leave'],
  ['meetings', 'meeting'],
  ['overtimes', 'overtime'],
  ['payments', 'payment'],
  ['processes', 'process'],
  ['procurement', 'purchase'],
  ['procurements', 'purchase'],
  ['purchases', 'purchase'],
  ['reimburse', 'expense'],
  ['reimbursement', 'expense'],
  ['reimbursements', 'expense'],
  ['requests', 'request'],
  ['rooms', 'room'],
  ['seals', 'seal'],
  ['submissions', 'submission'],
  ['stamp', 'seal'],
  ['stamps', 'seal'],
  ['travels', 'travel'],
  ['trip', 'travel'],
  ['trips', 'travel'],
  ['types', 'type'],
  ['vacation', 'leave'],
  ['vacations', 'leave'],
  ['vehicles', 'vehicle'],
  ['workflows', 'workflow'],
]);

const TOKEN_TRANSLATIONS = new Map<string, string>([
  ['attendance', '考勤'],
  ['contract', '合同'],
  ['finance', '财务'],
  ['invoice', '发票'],
  ['leave', '请假'],
  ['meeting', '会议'],
  ['overtime', '加班'],
  ['payment', '付款'],
  ['purchase', '采购'],
  ['room', '会议室'],
  ['seal', '用印'],
  ['travel', '差旅'],
  ['vehicle', '用车'],
]);

export function normalizeProcessName(input: ProcessNameNormalizationInput): string {
  const rawName = normalizeText(input.processName);
  if (rawName && containsChinese(rawName)) {
    return rawName;
  }

  const tokens = collectNormalizedTokens(rawName, input.processCode);
  const directMatch = findDirectProcessName(tokens);
  if (directMatch) {
    return directMatch;
  }

  const derivedName = deriveLocalizedProcessNameFromTokens(tokens);
  if (derivedName) {
    return derivedName;
  }

  if (rawName) {
    return rawName;
  }

  const rawCode = normalizeText(input.processCode);
  return rawCode || '流程申请';
}

export function deriveLocalizedProcessName(processCode?: string | null): string | null {
  const tokens = collectNormalizedTokens(processCode);
  return findDirectProcessName(tokens) || deriveLocalizedProcessNameFromTokens(tokens);
}

function normalizeText(value?: string | null): string {
  return String(value || '').trim();
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function collectNormalizedTokens(...values: Array<string | null | undefined>): string[] {
  const tokens: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    if (!normalized) {
      continue;
    }

    for (const token of normalized.split(/\s+/)) {
      const canonical = canonicalizeToken(token);
      if (canonical) {
        tokens.push(canonical);
      }
    }
  }

  return Array.from(new Set(tokens));
}

function canonicalizeToken(token: string): string {
  const directAlias = TOKEN_ALIASES.get(token);
  if (directAlias) {
    return directAlias;
  }

  const normalized = singularize(token);
  return TOKEN_ALIASES.get(normalized) || normalized;
}

function singularize(token: string): string {
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }

  return token;
}

function findDirectProcessName(tokens: string[]): string | null {
  for (const rule of DIRECT_PROCESS_NAME_RULES) {
    if (rule.requiredTokens.every((token) => tokens.includes(token))) {
      return rule.processName;
    }
  }

  return null;
}

function deriveLocalizedProcessNameFromTokens(tokens: string[]): string | null {
  const meaningfulTokens = tokens.filter((token) => !GENERIC_SUFFIX_TOKENS.has(token) && !/^\d+$/.test(token));
  if (meaningfulTokens.length === 0) {
    return null;
  }

  const translatedTokens = meaningfulTokens.map((token) => TOKEN_TRANSLATIONS.get(token)).filter(Boolean) as string[];
  if (translatedTokens.length !== meaningfulTokens.length) {
    return null;
  }

  const baseName = translatedTokens.join('');
  if (!baseName) {
    return null;
  }

  if (baseName.endsWith('申请') || baseName.endsWith('预约') || baseName.endsWith('报销')) {
    return baseName;
  }

  return `${baseName}申请`;
}
