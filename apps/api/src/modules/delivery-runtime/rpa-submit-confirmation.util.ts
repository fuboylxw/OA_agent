import type {
  BrowserPageSnapshot,
  RpaActionDefinition,
  RpaAssertionDefinition,
} from '@uniflow/shared-types';

const SUBMISSION_ID_KEYS = [
  'submissionId',
  'submission_id',
  'billNo',
  'billNO',
  'applyNo',
  'apply_no',
  'requestId',
  'request_id',
] as const;

const DRAFT_SIGNAL_PATTERNS = [
  '保存待发',
  '待发列表',
  '草稿',
  '暂存',
  '已保存',
  '保存成功',
  'saved to draft',
  'save to draft',
  'saved successfully',
  'draft',
] as const;

const SUBMIT_SUCCESS_PATTERNS = [
  '提交成功',
  '已提交',
  '提交完成',
  '送审成功',
  '已送审',
  '发起成功',
  '流程已发起',
  '申请成功',
  '审批中',
  '待审批',
  '待审核',
  'pending approval',
  'submitted successfully',
  'request submitted',
  'workflow started',
  'in approval',
] as const;

const INTERNAL_SUBMISSION_ID_PATTERNS = [
  /^vision[-_]/i,
  /^rpa[-_]/i,
  /^rpa-browser[-_]/i,
] as const;

export interface SubmitConfirmationInput {
  actionDefinition?: RpaActionDefinition;
  extractedValues?: Record<string, any>;
  finalSnapshot?: BrowserPageSnapshot;
  fallbackMessage?: string;
}

export interface SubmitConfirmationResult {
  confirmed: boolean;
  submissionId?: string;
  message?: string;
  failureReason?: string;
  matchedSuccessAssert: boolean;
  matchedSuccessText: boolean;
  matchedDraftSignal: boolean;
  matchedSignals: string[];
}

export function confirmRpaSubmit(input: SubmitConfirmationInput): SubmitConfirmationResult {
  const extractedValues = input.extractedValues || {};
  const snapshotTexts = collectSnapshotTexts(input.finalSnapshot);
  const candidateTexts = [
    ...snapshotTexts,
    ...collectPrimitiveStrings(extractedValues),
    input.fallbackMessage,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const submissionId = resolveSubmissionId(input.actionDefinition, extractedValues);
  const message = resolveMessage(input.actionDefinition, extractedValues) || input.fallbackMessage;
  const matchedSignals: string[] = [];

  const draftSignals = matchPatterns(candidateTexts, DRAFT_SIGNAL_PATTERNS);
  if (draftSignals.length > 0) {
    matchedSignals.push(...draftSignals);
  }

  const successAssertMatched = matchesSuccessAssert(
    input.actionDefinition?.successAssert,
    extractedValues,
    input.finalSnapshot,
    candidateTexts,
  );
  if (successAssertMatched && input.actionDefinition?.successAssert?.value) {
    matchedSignals.push(String(input.actionDefinition.successAssert.value));
  }

  const successSignals = matchPatterns(candidateTexts, SUBMIT_SUCCESS_PATTERNS);
  if (successSignals.length > 0) {
    matchedSignals.push(...successSignals);
  }

  const matchedDraftSignal = draftSignals.length > 0;
  const matchedSuccessText = successSignals.length > 0;
  const hasRealSubmissionId = Boolean(submissionId);
  const confirmed = !matchedDraftSignal && (hasRealSubmissionId || successAssertMatched || matchedSuccessText);

  if (confirmed) {
    return {
      confirmed: true,
      submissionId,
      message,
      matchedSuccessAssert: successAssertMatched,
      matchedSuccessText,
      matchedDraftSignal: false,
      matchedSignals: dedupeStrings(matchedSignals),
    };
  }

  return {
    confirmed: false,
    submissionId,
    message,
    failureReason: matchedDraftSignal
      ? 'RPA 仅完成了保存待发/草稿动作，未真正送审到 OA 审批流'
      : 'RPA 执行结束，但未识别到真实提交成功信号',
    matchedSuccessAssert: successAssertMatched,
    matchedSuccessText,
    matchedDraftSignal,
    matchedSignals: dedupeStrings(matchedSignals),
  };
}

export function normalizeExternalSubmissionId(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = typeof value === 'string'
    ? value.trim()
    : (typeof value === 'number' || typeof value === 'bigint')
      ? String(value)
      : '';

  if (!normalized) {
    return undefined;
  }

  if (INTERNAL_SUBMISSION_ID_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }

  return normalized;
}

function resolveSubmissionId(
  actionDefinition: RpaActionDefinition | undefined,
  extractedValues: Record<string, any>,
) {
  const mapped = readMappedValue(extractedValues, actionDefinition?.resultMapping?.submissionIdPath);
  if (mapped !== undefined && mapped !== null) {
    return normalizeExternalSubmissionId(mapped);
  }

  for (const key of SUBMISSION_ID_KEYS) {
    if (Object.prototype.hasOwnProperty.call(extractedValues, key)) {
      const normalized = normalizeExternalSubmissionId(extractedValues[key]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolveMessage(
  actionDefinition: RpaActionDefinition | undefined,
  extractedValues: Record<string, any>,
) {
  const mapped = coerceString(readMappedValue(extractedValues, actionDefinition?.resultMapping?.messagePath));
  if (mapped) {
    return mapped;
  }

  for (const key of ['message', 'tip', 'notice']) {
    if (Object.prototype.hasOwnProperty.call(extractedValues, key)) {
      const value = coerceString(extractedValues[key]);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

function matchesSuccessAssert(
  assertion: RpaAssertionDefinition | undefined,
  extractedValues: Record<string, any>,
  snapshot: BrowserPageSnapshot | undefined,
  candidateTexts: string[],
) {
  if (!assertion || !assertion.value) {
    return false;
  }

  const expected = normalizeText(assertion.value);
  if (!expected) {
    return false;
  }

  if (assertion.type === 'selector') {
    const selector = assertion.selector || assertion.value;
    const normalizedSelector = normalizeText(selector);
    return (snapshot?.interactiveElements || []).some((element) =>
      normalizeText(element.selector).includes(normalizedSelector),
    );
  }

  if (assertion.type === 'status_field') {
    const statusCandidates = [
      extractedValues.status,
      extractedValues.statusText,
      extractedValues.currentStatus,
      extractedValues.current_status,
    ]
      .map((value) => coerceString(value))
      .filter((value): value is string => Boolean(value));

    return statusCandidates.some((value) => normalizeText(value).includes(expected));
  }

  return candidateTexts.some((value) => normalizeText(value).includes(expected));
}

function matchPatterns(texts: string[], patterns: readonly string[]) {
  const matches = new Set<string>();
  const normalizedTexts = texts.map((value) => normalizeText(value)).filter(Boolean);

  for (const pattern of patterns) {
    const normalizedPattern = normalizeText(pattern);
    if (!normalizedPattern) {
      continue;
    }

    if (normalizedTexts.some((value) => value.includes(normalizedPattern))) {
      matches.add(pattern);
    }
  }

  return [...matches];
}

function collectSnapshotTexts(snapshot: BrowserPageSnapshot | undefined) {
  if (!snapshot) {
    return [] as string[];
  }

  return [
    snapshot.title,
    snapshot.structuredText,
    ...(snapshot.importantTexts || []),
    ...((snapshot.forms || []).flatMap((form) => [
      form.name,
      ...(form.fields || []).flatMap((field) => [field.label, field.fieldKey]),
    ])),
    ...((snapshot.tables || []).flatMap((table) => [table.name, table.summary])),
    ...((snapshot.dialogs || []).flatMap((dialog) => [dialog.title, dialog.summary])),
    ...((snapshot.interactiveElements || []).flatMap((element) => [
      element.label,
      element.text,
      element.fieldKey,
      element.value,
    ])),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function collectPrimitiveStrings(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPrimitiveStrings(item));
  }

  if (typeof value !== 'object') {
    return [];
  }

  return Object.values(value as Record<string, unknown>).flatMap((item) => collectPrimitiveStrings(item));
}

function readMappedValue(values: Record<string, any>, path: string | undefined) {
  if (!path) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(values, path)) {
    return values[path];
  }

  return path.split('.').reduce<any>((current, key) => current?.[key], values);
}

function coerceString(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return undefined;
}

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
