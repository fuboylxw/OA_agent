export interface ProcessNameNormalizationInput {
  processName?: string | null;
  processCode?: string | null;
}

const GENERIC_WRAPPER_TOKENS = new Set([
  'flow',
  'flows',
  'form',
  'forms',
  'process',
  'submission',
  'workflow',
  'workflows',
]);

export function normalizeProcessName(input: ProcessNameNormalizationInput): string {
  const rawName = normalizeText(input.processName);
  if (rawName && containsChinese(rawName)) {
    return rawName;
  }

  const tokens = collectNormalizedTokens(rawName, input.processCode);
  const derivedName = deriveHumanizedProcessNameFromTokens(tokens);
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
  return deriveHumanizedProcessNameFromTokens(tokens);
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
      const canonical = singularize(token);
      if (canonical) {
        tokens.push(canonical);
      }
    }
  }

  return Array.from(new Set(tokens));
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

function deriveHumanizedProcessNameFromTokens(tokens: string[]): string | null {
  const meaningfulTokens = trimGenericEdgeTokens(tokens.filter((token) => !/^\d+$/.test(token)));
  if (meaningfulTokens.length === 0) {
    return null;
  }

  return meaningfulTokens.map(humanizeToken).filter(Boolean).join(' ') || null;
}

function trimGenericEdgeTokens(tokens: string[]): string[] {
  if (tokens.length <= 1) {
    return tokens;
  }

  let start = 0;
  let end = tokens.length - 1;

  while (start < end && GENERIC_WRAPPER_TOKENS.has(tokens[start])) {
    start += 1;
  }

  while (end > start && GENERIC_WRAPPER_TOKENS.has(tokens[end])) {
    end -= 1;
  }

  return tokens.slice(start, end + 1);
}

function humanizeToken(token: string): string {
  if (!token) {
    return '';
  }

  return token.charAt(0).toUpperCase() + token.slice(1);
}
