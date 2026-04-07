export type AssistantFieldSemanticKind =
  | 'leave_type'
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
  const processCode = String(input.processCode || '').trim().toLowerCase();
  const normalized = normalizeLookupText([key, rawLabel, processCode]);
  const semanticKind = inferSemanticKind(normalized, processCode);
  const label = inferFriendlyLabel(rawLabel, normalized, semanticKind, processCode);
  const type = inferFriendlyType(rawType, semanticKind, input.options || []);
  const aliases = buildAliases(key, rawLabel, label, semanticKind);

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
  normalized: string,
  processCode: string,
): AssistantFieldSemanticKind {
  const leaveContext = /\bleave\b|请假|休假|假期/.test(`${normalized} ${processCode}`);

  if (/(attachment|attachments|file|files|upload|附件|材料|证明)/.test(normalized)) {
    return 'attachment';
  }
  if (leaveContext && /(leave type|leave_type|leaveType|vacation type|vacation_type|假别|请假类型|休假类型)/.test(normalized)) {
    return 'leave_type';
  }
  if (/(start time|start_time|startTime|start date|start_date|startDate|begin|from date|from_date|开始时间|开始日期|起始时间|起始日期)/.test(normalized)) {
    return 'start_time';
  }
  if (/(end time|end_time|endTime|end date|end_date|endDate|deadline|due date|due_date|结束时间|结束日期|截止时间|截止日期)/.test(normalized)) {
    return 'end_time';
  }
  if (/(reason|remark|comment|description|note|事由|原因|理由|说明)/.test(normalized)) {
    return 'reason';
  }
  if (/(amount|money|fee|cost|price|total|金额|费用|报销金额)/.test(normalized)) {
    return 'amount';
  }

  return 'generic';
}

function inferFriendlyLabel(
  rawLabel: string,
  normalized: string,
  semanticKind: AssistantFieldSemanticKind,
  processCode: string,
): string {
  if (rawLabel && !isProbablyRawFieldLabel(rawLabel)) {
    return rawLabel;
  }

  switch (semanticKind) {
    case 'leave_type':
      return '请假类型';
    case 'start_time':
      return '开始时间';
    case 'end_time':
      return '结束时间';
    case 'reason':
      return /\bleave\b|请假|休假/.test(`${normalized} ${processCode}`) ? '请假事由' : '事由';
    case 'attachment':
      return '附件';
    case 'amount':
      return '金额';
    default:
      break;
  }

  if (/(email|mail)/.test(normalized)) return '邮箱';
  if (/(phone|mobile|tel)/.test(normalized)) return '手机号';
  if (/(department|dept)/.test(normalized)) return '部门';
  if (/(name|real name|full name)/.test(normalized)) return '姓名';
  if (/(title|subject)/.test(normalized)) return '标题';
  if (/(content|body|detail|details)/.test(normalized)) return '内容';
  if (/(date|time|day)/.test(normalized)) return '时间';

  return '相关信息';
}

function inferFriendlyType(
  rawType: string,
  semanticKind: AssistantFieldSemanticKind,
  options: Array<{ label: string; value: string }>,
): string {
  const normalizedType = mapKnownType(rawType);
  if (options.length > 0 && (normalizedType === 'text' || normalizedType === 'input')) {
    return 'select';
  }

  if (normalizedType === 'text' || normalizedType === 'input') {
    switch (semanticKind) {
      case 'start_time':
      case 'end_time':
        return 'date';
      case 'reason':
        return 'textarea';
      case 'attachment':
        return 'file';
      case 'amount':
        return 'number';
      default:
        return normalizedType;
    }
  }

  return normalizedType;
}

function buildAliases(
  key: string,
  rawLabel: string,
  label: string,
  semanticKind: AssistantFieldSemanticKind,
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

  switch (semanticKind) {
    case 'leave_type':
      add('请假类型');
      add('假别');
      add('假期类型');
      break;
    case 'start_time':
      add('开始时间');
      add('开始日期');
      add('起始时间');
      add('起始日期');
      add('开始');
      break;
    case 'end_time':
      add('结束时间');
      add('结束日期');
      add('截止时间');
      add('截止日期');
      add('结束');
      break;
    case 'reason':
      add('请假事由');
      add('事由');
      add('原因');
      add('理由');
      add('说明');
      break;
    case 'attachment':
      add('附件');
      add('材料');
      add('证明');
      break;
    case 'amount':
      add('金额');
      add('费用');
      break;
    default:
      break;
  }

  return Array.from(aliases).filter(Boolean);
}

function mapKnownType(value: string): string {
  switch (String(value || 'text').trim().toLowerCase()) {
    case 'string':
      return 'text';
    case 'integer':
      return 'number';
    default:
      return String(value || 'text').trim().toLowerCase() || 'text';
  }
}

function normalizeLookupText(values: string[]): string {
  return values
    .map((value) => humanizeIdentifier(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function humanizeIdentifier(value: string): string {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
