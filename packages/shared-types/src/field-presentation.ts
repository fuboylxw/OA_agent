export type AssistantFieldSemanticKind =
  | 'start_time'
  | 'end_time'
  | 'reason'
  | 'attachment'
  | 'amount'
  | 'generic';

export interface AssistantFieldPresentationInput {
  key?: string | null;
  label?: string | null;
  type?: string | null;
  options?: Array<{ label: string; value: string }> | null;
  processCode?: string | null;
}

export interface AssistantFieldPresentation {
  label: string;
  type: string;
  aliases: string[];
  semanticKind: AssistantFieldSemanticKind;
  rawLabel: string;
  rawType: string;
}

const CJK_PATTERN = /[\u3400-\u9fff]/;
const RAW_IDENTIFIER_PATTERN = /^[a-z0-9_.-]+$/i;
const CAMEL_CASE_PATTERN = /^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

export function resolveAssistantFieldPresentation(
  input: AssistantFieldPresentationInput,
): AssistantFieldPresentation {
  const key = String(input.key || '').trim();
  const rawLabel = String(input.label || key || '').trim();
  const rawType = String(input.type || 'text').trim().toLowerCase();
  const type = inferFriendlyType(rawType, input.options || []);
  const semanticKind = inferSemanticKind(type);
  const label = inferFriendlyLabel(rawLabel, key);
  const aliases = buildAliases(key, rawLabel, label);

  return {
    label,
    type,
    aliases,
    semanticKind,
    rawLabel,
    rawType,
  };
}

export function isProbablyRawFieldLabel(value: string | null | undefined): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed) return true;
  if (CJK_PATTERN.test(trimmed)) return false;
  return RAW_IDENTIFIER_PATTERN.test(trimmed) || CAMEL_CASE_PATTERN.test(trimmed);
}

function inferSemanticKind(
  normalizedType: string,
): AssistantFieldSemanticKind {
  if (normalizedType === 'file') {
    return 'attachment';
  }
  return 'generic';
}

function inferFriendlyLabel(
  rawLabel: string,
  key: string,
): string {
  if (rawLabel && !isProbablyRawFieldLabel(rawLabel)) {
    return rawLabel;
  }

  return humanizeIdentifier(rawLabel || key) || '相关信息';
}

function inferFriendlyType(
  rawType: string,
  options: Array<{ label: string; value: string }>,
): string {
  const normalizedType = mapKnownType(rawType);
  if (options.length > 0 && (normalizedType === 'text' || normalizedType === 'input')) {
    return 'select';
  }

  return normalizedType;
}

function buildAliases(
  key: string,
  rawLabel: string,
  label: string,
): string[] {
  const aliases = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = String(value || '').trim();
    if (trimmed) aliases.add(trimmed);
  };

  add(key);
  add(rawLabel);
  add(label);
  add(humanizeIdentifier(key));
  add(humanizeIdentifier(rawLabel));

  return Array.from(aliases).filter(Boolean);
}

function mapKnownType(value: string): string {
  switch (String(value || 'text').trim().toLowerCase()) {
    case 'string':
      return 'text';
    case 'number':
    case 'integer':
    case 'float':
    case 'double':
      return 'number';
    case 'date':
    case 'datetime':
    case 'date-time':
      return 'date';
    case 'file':
    case 'upload':
    case 'attachment':
      return 'file';
    default:
      return String(value || 'text').trim().toLowerCase() || 'text';
  }
}

function humanizeIdentifier(value: string): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
