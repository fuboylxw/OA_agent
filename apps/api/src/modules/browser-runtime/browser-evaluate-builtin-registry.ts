import type { RpaStepDefinition } from '@uniflow/shared-types';

const CAPTURE_FORM_SUBMIT_SCRIPT = String.raw`
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readPath = (input, path) => String(path || '')
  .split('.')
  .filter(Boolean)
  .reduce((current, key) => current?.[key], input);
const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeComparableLabel = (value) => normalizeText(String(value ?? '')
  .replace(/[：:]\s*$/u, '')
  .replace(/[（(][^）)]*[）)]/gu, ' '))
  .toLowerCase();
const labelsRoughlyMatch = (left, right) => {
  const normalizedLeft = normalizeComparableLabel(left);
  const normalizedRight = normalizeComparableLabel(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const compactLeft = normalizedLeft.replace(/\s+/g, '');
  const compactRight = normalizedRight.replace(/\s+/g, '');
  return compactLeft === compactRight
    || compactLeft.startsWith(compactRight)
    || compactRight.startsWith(compactLeft);
};
const normalizeValue = (value) => {
  if (value === undefined || value === null) {
    return '';
  }
  const next = Array.isArray(value)
    ? value.filter((item) => item !== undefined && item !== null).join('、')
    : String(value);
  return normalizeText(next).replace('T', ' ');
};
const looksLikeJson = (value) => {
  const normalized = normalizeText(value);
  return (normalized.startsWith('{') && normalized.endsWith('}'))
    || (normalized.startsWith('[') && normalized.endsWith(']'));
};
const toAbsoluteUrl = (value) => {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
};
const getAccessibleWindows = () => {
  const windows = [window];
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    try {
      const frameWindow = iframe.contentWindow;
      const frameDocument = frameWindow?.document;
      if (!frameWindow || !frameDocument) {
        continue;
      }
      if (!windows.includes(frameWindow)) {
        windows.push(frameWindow);
      }
    } catch {
      // ignore cross-origin frames
    }
  }
  return windows;
};
const getAccessibleDocuments = () => getAccessibleWindows()
  .map((currentWindow) => {
    try {
      return currentWindow.document ? {
        window: currentWindow,
        document: currentWindow.document,
      } : null;
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const resolveDocuments = (frameOptions) => {
  const docs = getAccessibleDocuments();
  if (!frameOptions || typeof frameOptions !== 'object') {
    return docs;
  }
  const matched = docs.filter((entry) => {
    const currentWindow = entry.window;
    const frameElement = currentWindow.frameElement;
    if (frameOptions.selector) {
      return frameElement?.matches?.(frameOptions.selector);
    }
    if (frameOptions.name) {
      return currentWindow.name === frameOptions.name || frameElement?.name === frameOptions.name || frameElement?.id === frameOptions.name;
    }
    return false;
  });
  if (matched.length === 0) {
    throw new Error('Configured iframe target is not ready');
  }
  return matched;
};
const extractTableCellLabel = (element) => {
  const cell = element?.closest?.('td, th');
  const row = cell?.parentElement;
  if (!cell || !row) {
    return '';
  }
  const cellContainsFieldValue = (candidateCell) => {
    if (!candidateCell?.querySelectorAll) {
      return false;
    }
    if (candidateCell.querySelector('input:not([type="hidden"]), textarea, select, button, [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"]')) {
      return true;
    }
    return Array.from(candidateCell.querySelectorAll('div, span, section, label')).some((node) =>
      node !== candidateCell
      && (isChoiceLikeElement(node) || isAttachmentLikeElement(node) || isFieldContainerLikeElement(node)));
  };
  const cells = Array.from(row.children || []).filter((node) => node?.matches?.('td, th'));
  const index = cells.indexOf(cell);
  if (index < 0) {
    return '';
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (cellContainsFieldValue(cells[cursor])) {
      continue;
    }
    const text = normalizeText(cells[cursor]?.textContent || '').replace(/[：:]\s*$/u, '');
    if (text) {
      return text;
    }
  }
  return '';
};
const getRowEditableElements = (element) => {
  const row = element?.closest?.('tr');
  if (!row?.querySelectorAll) {
    return [];
  }
  return Array.from(row.querySelectorAll('input, textarea, select'))
    .filter((node) => {
      if (!node || node === element) {
        return false;
      }
      const type = normalizeText(node.getAttribute?.('type') || node.type || '').toLowerCase();
      return type !== 'hidden' && !isFileInputElement(node);
    });
};
const looksLikeDateBoundaryLabel = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (/(开始|起始|起|from|start)/iu.test(normalized)) {
    return 'start';
  }
  if (/(结束|截止|止|to|end)/iu.test(normalized)) {
    return 'end';
  }
  return '';
};
const resolveRangeFieldAlternativeTarget = (documents, requestedTarget) => {
  const expectedLabel = normalizeText(requestedTarget?.label || requestedTarget?.text || '');
  const boundary = looksLikeDateBoundaryLabel(expectedLabel);
  if (!expectedLabel || !boundary) {
    return null;
  }

  for (const entry of documents) {
    const doc = entry.document;
    const editableFields = Array.from(doc.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    for (const field of editableFields) {
      const rowLabel = extractTableCellLabel(field);
      if (!/(时间|日期|time|date)/iu.test(rowLabel || '')) {
        continue;
      }
      const siblings = [field, ...getRowEditableElements(field)];
      if (siblings.length < 2) {
        continue;
      }
      const target = boundary === 'start'
        ? siblings[0]
        : siblings[siblings.length - 1];
      if (target) {
        return { element: target, document: doc, window: entry.window };
      }
    }
  }

  return null;
};
const checkedKeywords = ['checked', 'selected', 'active', 'enabled', 'on'];
const uncheckedKeywords = ['unchecked', 'unselected', 'inactive', 'disabled', 'off', 'default'];
const closestMatchingAncestor = (element, predicate, maxDepth = 8) => {
  let current = element;
  let depth = 0;
  while (current && depth <= maxDepth) {
    if (predicate(current)) {
      return current;
    }
    current = current.parentElement;
    depth += 1;
  }
  return null;
};
const isFileInputElement = (element) => {
  if (!element) {
    return false;
  }
  const typeAttr = normalizeText(element.getAttribute?.('type') || '');
  const typeProp = normalizeText(element.type || '');
  return typeAttr.toLowerCase() === 'file' || typeProp.toLowerCase() === 'file';
};
const isAttachmentLikeElement = (element) => Boolean(
  isFileInputElement(element)
  || element?.querySelector?.('input[type="file"]')
);
const isChoiceLikeElement = (element) => Boolean(
  element?.matches?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]')
  || /(?:^|[\s_-])(checkbox|radio|choice|option)(?:$|[\s_-])/i.test(normalizeText([
    element?.getAttribute?.('class'),
    element?.getAttribute?.('role'),
    element?.tagName,
  ].filter(Boolean).join(' ')))
  || element?.querySelector?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]')
  || element?.querySelector?.('[class*="checkbox"], [class*="radio"], [class*="choice"], [class*="option"]')
);
const isFieldContainerLikeElement = (element) => Boolean(
  element?.matches?.('input, textarea, select, [role="textbox"], [role="combobox"], [role="group"]')
  || element?.querySelector?.('input:not([type="hidden"]), textarea, select, [role="textbox"], [role="combobox"]')
);
const scoreSemanticFieldRootCandidate = (candidate) => {
  if (!candidate) {
    return -1;
  }
  let score = 0;
  const tagName = normalizeText(candidate?.tagName || '').toLowerCase();
  const className = normalizeText(candidate?.getAttribute?.('class') || '').toLowerCase();
  const identity = normalizeText(
    candidate?.id
    || candidate?.getAttribute?.('name')
    || candidate?.dataset?.fieldName
    || candidate?.dataset?.name
    || '',
  );
  if (identity) {
    score += 14;
  }
  if (candidate?.matches?.('input, textarea, select, [role="textbox"], [role="combobox"]')) {
    score += 12;
  }
  if (candidate?.matches?.('[role="checkbox"], [role="radio"]')) {
    score += 10;
  }
  if (candidate?.querySelector?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]')) {
    score += 8;
  }
  if (candidate?.querySelector?.('input:not([type="hidden"]), textarea, select, [role="textbox"], [role="combobox"]')) {
    score += 6;
  }
  if (findSemanticTitleNode(candidate)) {
    score += 6;
  }
  const descendantCount = Number(candidate?.querySelectorAll?.('*')?.length || 0);
  score -= Math.min(descendantCount, 80) / 10;
  const textLength = normalizeText(candidate?.textContent || '').length;
  score -= Math.min(textLength, 240) / 60;
  if (/(icon|prefix|suffix|caption|content|wrapper|left|right)/i.test(className)) {
    score -= 6;
  }
  if (/^(i|svg|img)$/i.test(tagName) || /icon/i.test(className)) {
    score -= 8;
  }
  return score;
};
const findSemanticFieldRoot = (element) => {
  let current = element;
  let depth = 0;
  let bestMatch = null;
  let bestScore = -1;
  while (current && depth <= 8) {
    if (isAttachmentLikeElement(current) || isChoiceLikeElement(current) || isFieldContainerLikeElement(current)) {
      const score = scoreSemanticFieldRootCandidate(current);
      if (score >= bestScore) {
        bestScore = score;
        bestMatch = current;
      }
    }
    current = current.parentElement;
    depth += 1;
  }
  return bestMatch;
};
const findSemanticTitleNode = (container) => {
  if (!container?.querySelectorAll) {
    return null;
  }
  return Array.from(container.querySelectorAll(
    'label, legend, th, td, h1, h2, h3, h4, [role="heading"], [class*="title"], [class*="label"], [class*="name"], [class*="caption"], [class*="header"], [class*="left"]',
  )).find((node) => normalizeText(node?.textContent || '').length > 0) || null;
};
const collectSemanticFieldCandidates = (doc, expectedKind) => {
  if (!doc?.querySelectorAll) {
    return [];
  }
  const selector = expectedKind === 'attachment'
    ? 'input[type="file"], button, a, div, span, label, section'
    : 'input, textarea, select, button, a, div, span, label, section, [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="group"]';
  const seen = new Set();
  return Array.from(doc.querySelectorAll(selector))
    .map((node) => expectedKind === 'attachment'
      ? closestMatchingAncestor(node, isAttachmentLikeElement, 8)
      : findSemanticFieldRoot(node))
    .filter((node) => {
      if (!node || seen.has(node)) {
        return false;
      }
      seen.add(node);
      return expectedKind === 'attachment' ? isAttachmentLikeElement(node) : true;
    });
};
const extractElementLabel = (element) => {
  if (!element) {
    return '';
  }
  const fieldRoot = findSemanticFieldRoot(element);
  const titleNode = findSemanticTitleNode(fieldRoot);
  const labelNode = element.closest('label')
    || (element.id ? element.ownerDocument.querySelector('label[for="' + element.id + '"]') : null)
    || element.parentElement?.querySelector?.('label')
    || null;
  return normalizeText(
    titleNode?.textContent
    || fieldRoot?.getAttribute?.('title')
    || labelNode?.textContent
    || extractTableCellLabel(element)
    || element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
    || element.getAttribute?.('placeholder')
    || element.getAttribute?.('name')
    || element.getAttribute?.('id')
    || ''
  );
};
const normalizeHeaders = (headersLike) => {
  if (!headersLike) {
    return {};
  }
  if (typeof Headers !== 'undefined' && headersLike instanceof Headers) {
    return Object.fromEntries(Array.from(headersLike.entries()).map(([key, value]) => [
      normalizeText(key).toLowerCase(),
      normalizeText(value),
    ]).filter(([, value]) => Boolean(value)));
  }
  if (Array.isArray(headersLike)) {
    return Object.fromEntries(headersLike
      .map((entry) => Array.isArray(entry) && entry.length >= 2
        ? [normalizeText(entry[0]).toLowerCase(), normalizeText(entry[1])]
        : null)
      .filter(Boolean));
  }
  if (typeof headersLike === 'object') {
    return Object.fromEntries(Object.entries(headersLike)
      .map(([key, value]) => [normalizeText(key).toLowerCase(), normalizeText(value)])
      .filter(([, value]) => Boolean(value)));
  }
  return {};
};
const inferBodyMode = (headers, fallback) => {
  const contentType = normalizeText(headers?.['content-type'] || headers?.['Content-Type'] || '').toLowerCase();
  if (fallback === 'multipart' || contentType.includes('multipart/form-data')) {
    return 'multipart';
  }
  if (fallback === 'json' || contentType.includes('application/json') || contentType.includes('text/json')) {
    return 'json';
  }
  if (fallback === 'form' || contentType.includes('application/x-www-form-urlencoded')) {
    return 'form';
  }
  return fallback || 'form';
};
const normalizeBodyFields = (body, bodyMode, ownerWindow) => {
  const nextBodyMode = bodyMode || 'form';
  if (body === undefined || body === null) {
    return {
      bodyMode: nextBodyMode,
      fields: {},
      rawBody: '',
    };
  }

  if (typeof ownerWindow?.FormData !== 'undefined' && body instanceof ownerWindow.FormData) {
    return {
      bodyMode: 'multipart',
      fields: Object.fromEntries(Array.from(body.entries()).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : value?.name || '',
      ])),
      rawBody: '',
    };
  }

  if (typeof ownerWindow?.URLSearchParams !== 'undefined' && body instanceof ownerWindow.URLSearchParams) {
    return {
      bodyMode: 'form',
      fields: Object.fromEntries(Array.from(body.entries())),
      rawBody: String(body),
    };
  }

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (looksLikeJson(trimmed)) {
      try {
        return {
          bodyMode: 'json',
          fields: JSON.parse(trimmed),
          rawBody: trimmed,
        };
      } catch {
        // fall through
      }
    }
    try {
      const params = new URLSearchParams(trimmed);
      const parsedEntries = Array.from(params.entries());
      if (parsedEntries.length > 0) {
        return {
          bodyMode: 'form',
          fields: Object.fromEntries(parsedEntries),
          rawBody: trimmed,
        };
      }
    } catch {
      // ignore parse errors
    }
    return {
      bodyMode: nextBodyMode,
      fields: {},
      rawBody: trimmed,
    };
  }

  if (typeof body === 'object') {
    return {
      bodyMode: nextBodyMode === 'form' ? 'json' : nextBodyMode,
      fields: body,
      rawBody: JSON.stringify(body),
    };
  }

  return {
    bodyMode: nextBodyMode,
    fields: {},
    rawBody: String(body),
  };
};
const createSubmitRecord = (input) => {
  const ownerWindow = input?.ownerWindow || window;
  const absoluteUrl = toAbsoluteUrl(input?.action || input?.url || ownerWindow.location?.href || '');
  const headers = normalizeHeaders(input?.headers);
  const normalizedBody = normalizeBodyFields(
    input?.body,
    inferBodyMode(headers, input?.bodyMode),
    ownerWindow,
  );
  return {
    type: normalizeText(input?.type || 'request') || 'request',
    action: absoluteUrl,
    url: absoluteUrl,
    method: normalizeText(input?.method || 'post').toLowerCase() || 'post',
    headers,
    fields: normalizedBody.fields || {},
    rawBody: normalizedBody.rawBody || '',
    bodyMode: normalizedBody.bodyMode || 'form',
    enctype: normalizeText(input?.enctype || ''),
    origin: (() => {
      try {
        return new URL(absoluteUrl || ownerWindow.location?.href || ownerWindow.location?.origin || '', ownerWindow.location?.href || window.location.href).origin;
      } catch {
        return normalizeText(ownerWindow.location?.origin || '');
      }
    })(),
  };
};
const isLikelyTerminalSubmitRecord = (record) => {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const type = normalizeText(record.type || '').toLowerCase();
  const action = normalizeText(record.action || record.url || '').toLowerCase();
  const method = normalizeText(record.method || '').toLowerCase();
  const rawBody = normalizeText(record.rawBody || '').toLowerCase();
  const fields = record.fields && typeof record.fields === 'object' ? record.fields : {};
  const fieldCount = Object.keys(fields).length;
  const hasStructuredPayload = Boolean(
    fields._json_params
    || fields.CSRFTOKEN
    || (fields.content && typeof fields.content === 'object')
    || rawBody.includes('_json_params')
    || rawBody.includes('csrftoken'),
  );
  const isValidationLike = /check|validate|verify|canuse|preview|precheck/i.test(action)
    || /checktemplatecanuse|validate|verify|preview/i.test(rawBody);
  if (isValidationLike) {
    return false;
  }
  if (type === 'form.submit' || type === 'form.requestsubmit') {
    return true;
  }
  if (/(savedraft|submit|send|approve|apply|startworkflow|startprocess)/i.test(action)) {
    return true;
  }
  if (/(savedraft|submit|send|approve|apply|startworkflow|startprocess)/i.test(rawBody)) {
    return true;
  }
  if (/saveorupdate/i.test(action)) {
    return false;
  }
  return ['post', 'put', 'patch'].includes(method) && hasStructuredPayload && fieldCount >= 3;
};
const shouldMatchCaptureRecord = (record, pattern) => {
  if (!pattern) {
    return isLikelyTerminalSubmitRecord(record);
  }
  return pattern.test(String(record?.action || record?.url || ''))
    || pattern.test(String(record?.rawBody || ''));
};
const createStubResponsePayload = (record) => {
  const contentType = normalizeText(record?.headers?.['content-type'] || '').toLowerCase();
  if (contentType.includes('application/json') || /json|ajax/i.test(String(record?.action || ''))) {
    return {
      body: '{"success":true}',
      contentType: 'application/json',
    };
  }
  return {
    body: '',
    contentType: 'text/plain',
  };
};
const scoreResolvedElementCandidate = (element, expectedLabel, options = {}) => {
  if (!element) {
    return -1;
  }
  const normalizedExpectedLabel = normalizeText(expectedLabel);
  if (!normalizedExpectedLabel) {
    return -1;
  }
  const componentRoot = findSemanticFieldRoot(element) || element;
  const extractedLabel = extractElementLabel(element);
  const componentLabel = extractElementLabel(componentRoot);
  const aliases = Array.from(new Set([
    extractedLabel,
    componentLabel,
    normalizeText(componentRoot?.textContent || ''),
    normalizeText(element?.textContent || ''),
    normalizeText(element?.getAttribute?.('title') || ''),
    normalizeText(element?.getAttribute?.('aria-label') || ''),
  ].filter(Boolean)));
  if (!aliases.some((alias) => labelsRoughlyMatch(alias, normalizedExpectedLabel))) {
    return -1;
  }

  let score = 0;
  if (aliases.some((alias) => normalizeComparableLabel(alias) === normalizeComparableLabel(normalizedExpectedLabel))) {
    score += 16;
  }
  if (labelsRoughlyMatch(extractedLabel, normalizedExpectedLabel)) {
    score += 12;
  }
  if (labelsRoughlyMatch(componentLabel, normalizedExpectedLabel)) {
    score += 10;
  }
  if (options.expectAttachmentComponent && isAttachmentLikeElement(componentRoot)) {
    score += 12;
  }
  if (!options.expectAttachmentComponent && isChoiceLikeElement(componentRoot)) {
    score += 10;
  }
  if (!options.expectAttachmentComponent && isFieldContainerLikeElement(componentRoot)) {
    score += 6;
  }

  const roleHints = normalizeText([
    componentRoot?.getAttribute?.('role'),
    componentRoot?.getAttribute?.('class'),
    componentRoot?.tagName,
    element?.getAttribute?.('role'),
    element?.getAttribute?.('class'),
    element?.tagName,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (/(checkbox|radio|choice|option)/i.test(roleHints)) {
    score += 8;
  }
  if (/(upload|attach|file)/i.test(roleHints)) {
    score += 8;
  }

  const textLength = normalizeText(componentRoot?.textContent || '').length;
  if (textLength > 0) {
    score += Math.max(0, 12 - Math.min(textLength, 120) / 10);
  }

  const descendantCount = Number(componentRoot?.querySelectorAll?.('*')?.length || 0);
  score -= Math.min(descendantCount, 80) / 10;
  if (componentRoot === element) {
    score += 2;
  }
  return score;
};
const pickBestResolvedElementCandidate = (documents, target, options = {}) => {
  const expectedLabel = normalizeText(target?.label || target?.text || target?.placeholder || '');
  if (!expectedLabel) {
    return null;
  }

  let bestMatch = null;
  let bestScore = -1;
  for (const entry of documents) {
    const doc = entry.document;
    const candidates = collectSemanticFieldCandidates(
      doc,
      options.expectAttachmentComponent ? 'attachment' : 'field',
    );
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (options.allowFileInput === false && isFileInputElement(candidate)) {
        continue;
      }
      if (options.expectAttachmentComponent && !isAttachmentLikeElement(candidate)) {
        continue;
      }
      const score = scoreResolvedElementCandidate(candidate, expectedLabel, options);
      if (score <= bestScore) {
        continue;
      }
      bestScore = score;
      bestMatch = {
        element: candidate,
        document: doc,
        window: entry.window,
        score,
      };
    }
  }

  return bestMatch;
};
const scoreCapturedRequest = (record, pattern) => {
  if (!record) {
    return -1;
  }
  let score = 0;
  const action = normalizeText(record.action || record.url || '').toLowerCase();
  const method = normalizeText(record.method || '').toLowerCase();
  const headers = normalizeHeaders(record.headers);
  const fields = record.fields && typeof record.fields === 'object' ? record.fields : {};
  const rawBody = normalizeText(record.rawBody || '');
  if (pattern && shouldMatchCaptureRecord(record, pattern)) {
    score += 40;
  }
  if (/savedraft|submit|send|collaboration/i.test(action)) {
    score += 18;
  }
  if (/checktemplatecanuse|check|validate|verify/i.test(action)) {
    score -= 28;
  }
  if (method === 'post') {
    score += 6;
  }
  if (Object.keys(fields).length > 3) {
    score += 8;
  }
  if (fields._json_params || fields.CSRFTOKEN) {
    score += 14;
  }
  if (/application\/x-www-form-urlencoded|multipart\/form-data|application\/json/i.test(String(headers['content-type'] || ''))) {
    score += 4;
  }
  if (/managerMethod=saveDraft|method=saveDraft|_json_params|CSRFTOKEN/i.test(rawBody)) {
    score += 14;
  }
  if (/managerMethod=checkTemplateCanUse|checkTemplateCanUse/i.test(rawBody)) {
    score -= 24;
  }
  return score;
};
const pickBestCapturedRequest = (matches, pattern) => {
  if (!Array.isArray(matches) || matches.length === 0) {
    return null;
  }
  let bestRecord = matches[matches.length - 1];
  let bestScore = scoreCapturedRequest(bestRecord, pattern);
  matches.forEach((record) => {
    const score = scoreCapturedRequest(record, pattern);
    if (score >= bestScore) {
      bestScore = score;
      bestRecord = record;
    }
  });
  return bestRecord;
};
const resolveNamedElement = (documents, target, options = {}) => {
  if (!Array.isArray(documents) || !target || typeof target !== 'object') {
    return null;
  }
  const allowFileInput = options.allowFileInput !== false;
  const expectAttachmentComponent = options.expectAttachmentComponent === true;
  for (const entry of documents) {
    const doc = entry.document;
    if (!doc) {
      continue;
    }
    if (target.selector) {
      const selectorMatch = doc.querySelector(target.selector);
      if (
        selectorMatch
        && (allowFileInput || !isFileInputElement(selectorMatch))
        && (!expectAttachmentComponent || isAttachmentLikeElement(selectorMatch))
      ) {
        return { element: selectorMatch, document: doc, window: entry.window };
      }
    }
    if (target.id) {
      const idMatch = doc.getElementById(target.id);
      if (
        idMatch
        && (allowFileInput || !isFileInputElement(idMatch))
        && (!expectAttachmentComponent || isAttachmentLikeElement(idMatch))
      ) {
        return { element: idMatch, document: doc, window: entry.window };
      }
    }
    if (target.name) {
      const nameMatch = doc.getElementsByName(target.name)?.[0] || null;
      if (
        nameMatch
        && (allowFileInput || !isFileInputElement(nameMatch))
        && (!expectAttachmentComponent || isAttachmentLikeElement(nameMatch))
      ) {
        return { element: nameMatch, document: doc, window: entry.window };
      }
    }
  }
  const expectedLabel = normalizeText(target.label || target.text || target.placeholder || '');
  if (!expectedLabel) {
    return null;
  }
  const scoredMatch = pickBestResolvedElementCandidate(documents, target, {
    allowFileInput,
    expectAttachmentComponent,
  });
  if (scoredMatch?.element) {
    return {
      element: scoredMatch.element,
      document: scoredMatch.document,
      window: scoredMatch.window,
    };
  }
  if (!expectAttachmentComponent) {
    const rangeTarget = resolveRangeFieldAlternativeTarget(documents, target);
    if (rangeTarget) {
      return rangeTarget;
    }
  }
  if (expectAttachmentComponent) {
    return null;
  }
  if (!allowFileInput) {
    return null;
  }
  const uploadCandidates = [];
  for (const entry of documents) {
    const doc = entry.document;
    const fileInputs = Array.from(doc.querySelectorAll('input[type="file"]'));
    for (let index = 0; index < fileInputs.length; index += 1) {
      const input = fileInputs[index];
      const directMeta = normalizeText([
        input.getAttribute?.('name'),
        input.getAttribute?.('id'),
        input.getAttribute?.('title'),
        input.getAttribute?.('aria-label'),
        input.getAttribute?.('placeholder'),
        input.getAttribute?.('class'),
      ].filter(Boolean).join(' '));
      const nearbyText = normalizeText([
        input.closest('label')?.textContent,
        input.id ? doc.querySelector('label[for="' + input.id + '"]')?.textContent : '',
        input.parentElement?.textContent,
        input.closest('[class*="upload"], [class*="attach"], [id*="upload"], [id*="attach"]')?.textContent,
        input.previousElementSibling?.textContent,
        input.nextElementSibling?.textContent,
      ].filter(Boolean).join(' '));
      let score = 0;
      if (labelsRoughlyMatch(directMeta, expectedLabel)) {
        score += 8;
      }
      if (labelsRoughlyMatch(nearbyText, expectedLabel)) {
        score += 6;
      }
      if (fileInputs.length === 1 && score > 0) {
        score += 2;
      }
      if (score > 0) {
        uploadCandidates.push({
          element: input,
          document: doc,
          window: entry.window,
          score,
        });
      }
    }
  }
  uploadCandidates.sort((left, right) => right.score - left.score);
  if (uploadCandidates[0]) {
    return uploadCandidates[0];
  }
  const allFileInputs = documents.flatMap((entry) =>
    Array.from(entry.document?.querySelectorAll?.('input[type="file"]') || []).map((element) => ({
      element,
      document: entry.document,
      window: entry.window,
    })));
  if (allFileInputs.length === 1) {
    return allFileInputs[0];
  }
  return null;
};
const resolveSourceValue = (mapping) => {
  const candidates = [
    ...(Array.isArray(mapping?.sources) ? mapping.sources : []),
    mapping?.source,
    mapping?.fieldKey,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const path = String(candidate);
    const explicit = path.includes('.')
      ? readPath(context, path)
      : (
        context.formData?.[path]
        ?? context.payload?.formData?.[path]
        ?? readPath(context, path)
      );
    if (explicit !== undefined && explicit !== null && normalizeValue(explicit)) {
      return explicit;
    }
  }
  return mapping?.defaultValue;
};
const splitChoiceValues = (value) => {
  const queue = Array.isArray(value) ? value : [value];
  const results = [];
  for (const entry of queue) {
    const normalizedEntry = normalizeText(entry);
    if (!normalizedEntry) {
      continue;
    }
    const parts = normalizedEntry.split(/[、,，;；\n]/).map((item) => normalizeText(item)).filter(Boolean);
    if (parts.length > 0) {
      results.push(...parts);
    } else {
      results.push(normalizedEntry);
    }
  }
  return Array.from(new Set(results));
};
const collectOptionAliases = (option) => {
  if (typeof option === 'string') {
    const normalized = normalizeText(option);
    return normalized ? [normalized] : [];
  }
  if (!option || typeof option !== 'object') {
    return [];
  }
  return Array.from(new Set([
    normalizeText(option.label),
    normalizeText(option.value),
  ].filter(Boolean)));
};
const escapeCssValue = (value) => {
  const normalized = String(value ?? '');
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(normalized);
  }
  return normalized.replace(/["\\]/g, '\\$&');
};
const dispatchFieldEvents = (target) => {
  const ownerWindow = target?.ownerDocument?.defaultView || window;
  ['input', 'change', 'blur'].forEach((eventName) => {
    target.dispatchEvent(new ownerWindow.Event(eventName, { bubbles: true }));
  });
};
const collectElementAliases = (element) => {
  if (!element) {
    return [];
  }
  const componentRoot = findSemanticFieldRoot(element) || element;
  return Array.from(new Set([
    normalizeText(element.value),
    normalizeText(element.getAttribute?.('value')),
    normalizeText(element.getAttribute?.('aria-label')),
    normalizeText(element.getAttribute?.('title')),
    normalizeText(element.nextElementSibling?.textContent),
    normalizeText(element.previousElementSibling?.textContent),
    normalizeText(componentRoot?.textContent),
    extractElementLabel(element),
  ].filter(Boolean)));
};
const resolveChoiceGroup = (target, inputType) => {
  const ownerDocument = target?.ownerDocument;
  if (!ownerDocument) {
    return target ? [target] : [];
  }
  const normalizedType = normalizeText(inputType || target?.type || target?.getAttribute?.('type')).toLowerCase();
  const normalizedName = normalizeText(target?.getAttribute?.('name') || target?.name || '');
  if (normalizedType && normalizedName) {
    try {
      const namedGroup = Array.from(ownerDocument.querySelectorAll(
        'input[type="' + normalizedType + '"][name="' + escapeCssValue(normalizedName) + '"]',
      ));
      if (namedGroup.length > 0) {
        return namedGroup;
      }
    } catch {
      // ignore selector failures
    }
  }
  const container = target.closest?.('fieldset, tr, .form-row, .ant-form-item, .el-form-item, .layui-form-item, td, li, div, section');
  if (container && normalizedType) {
    const localGroup = Array.from(container.querySelectorAll('input[type="' + normalizedType + '"]'));
    if (localGroup.length > 0) {
      return localGroup;
    }
  }
  return target ? [target] : [];
};
const aliasesMatchChoices = (aliases, choices) => choices.some((choice) =>
  aliases.some((alias) => alias === choice));
const collectMappedOptionAliases = (optionElement, mappingOptions) => {
  const baseAliases = Array.from(new Set([
    normalizeText(optionElement?.value),
    normalizeText(optionElement?.label),
    normalizeText(optionElement?.textContent),
  ].filter(Boolean)));
  const matchedMappingOptions = (Array.isArray(mappingOptions) ? mappingOptions : [])
    .filter((option) => {
      const aliases = collectOptionAliases(option);
      return aliasesMatchChoices(baseAliases, aliases) || aliasesMatchChoices(aliases, baseAliases);
    });
  return Array.from(new Set([
    ...baseAliases,
    ...matchedMappingOptions.flatMap((option) => collectOptionAliases(option)),
  ].filter(Boolean)));
};
const resolveEditableTarget = (target) => {
  if (!target) {
    return target;
  }
  if (target.matches?.('input, textarea, select')) {
    return target;
  }
  const nestedEditable = target.querySelector?.('textarea, input:not([type="hidden"]):not([type="file"]), select');
  return nestedEditable || target;
};
const isChoiceLikeFieldType = (fieldType) => {
  const normalizedType = normalizeText(fieldType).toLowerCase();
  return normalizedType === 'checkbox'
    || normalizedType === 'radio'
    || normalizedType === 'select';
};
const findBindingContainer = (element) => {
  if (!element) {
    return null;
  }
  return closestMatchingAncestor(
    element,
    (candidate) => Boolean(
      normalizeText(
        candidate?.id
        || candidate?.getAttribute?.('name')
        || candidate?.dataset?.fieldName
        || candidate?.dataset?.name
        || '',
      ),
    ),
    8,
  ) || element;
};
const buildResolvedTargetDescriptor = (target, requestedTarget, mapping) => {
  if (!target) {
    return null;
  }
  const componentRoot = findSemanticFieldRoot(target) || target;
  const bindingContainer = findBindingContainer(componentRoot);
  const editableTarget = resolveEditableTarget(bindingContainer);
  const id = normalizeText(
    bindingContainer?.id
    || componentRoot?.id
    || editableTarget?.id
    || requestedTarget?.id,
  );
  const name = normalizeText(
    bindingContainer?.getAttribute?.('name')
    || componentRoot?.getAttribute?.('name')
    || editableTarget?.getAttribute?.('name')
    || editableTarget?.name
    || requestedTarget?.name,
  );
  const label = normalizeText(requestedTarget?.label || requestedTarget?.text || extractElementLabel(target) || extractElementLabel(componentRoot));
  const selector = normalizeText(
    requestedTarget?.selector
    || (id ? ('#' + String(id).replace(/["\\]/g, '\\$&')) : ''),
  );
  const requestFieldName = normalizeText(
    bindingContainer?.dataset?.fieldName
    || bindingContainer?.getAttribute?.('name')
    || bindingContainer?.id
    || componentRoot?.dataset?.fieldName
    || componentRoot?.getAttribute?.('name')
    || editableTarget?.getAttribute?.('name')
    || editableTarget?.name
    || (isAttachmentLikeElement(componentRoot) ? (componentRoot?.id || editableTarget?.id || '') : '')
    || requestedTarget?.requestFieldName,
  );
  const inferredType = normalizeText(
    mapping?.fieldType
    || (isAttachmentLikeElement(componentRoot) ? 'file' : '')
    || (isChoiceLikeElement(componentRoot) ? 'checkbox' : '')
    || editableTarget?.type
    || editableTarget?.tagName,
  ).toLowerCase();
  const descriptor = {
    ...(requestedTarget && typeof requestedTarget === 'object' ? requestedTarget : {}),
    ...(label ? { label } : {}),
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(selector ? { selector } : {}),
    ...(requestFieldName ? { requestFieldName } : {}),
  };
  return {
    descriptor,
    binding: {
      key: normalizeText(mapping?.fieldKey),
      ...(label ? { label } : {}),
      ...(inferredType ? { type: inferredType } : {}),
      ...(Array.isArray(mapping?.options) && mapping.options.length > 1 ? { multiple: true } : {}),
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(selector ? { selector } : {}),
      ...(requestFieldName ? { requestFieldName } : {}),
    },
  };
};
const resolveExecutableMappings = (documents, mapping) => {
  const originalMatch = resolveNamedElement(documents, mapping?.target, { allowFileInput: false });
  const originalTarget = originalMatch?.element;
  const originalComponentRoot = findSemanticFieldRoot(originalTarget) || originalTarget;
  const originalEditableTarget = resolveEditableTarget(originalComponentRoot);
  const originalTagName = normalizeText(originalEditableTarget?.tagName || originalTarget?.tagName).toLowerCase();
  const options = Array.isArray(mapping?.options) ? mapping.options : [];
  const shouldExpandChoices = isChoiceLikeFieldType(mapping?.fieldType)
    && options.length > 1
    && originalTagName !== 'select';
  if (!shouldExpandChoices) {
    return [{
      mapping,
      targetMatch: originalMatch,
    }];
  }
  const expanded = options.map((option) => {
    const aliases = collectOptionAliases(option);
    const optionLabel = aliases[0] || normalizeText(mapping?.target?.label);
    const optionTarget = {
      ...(mapping?.target && typeof mapping.target === 'object' ? mapping.target : {}),
      ...(optionLabel ? { label: optionLabel } : {}),
    };
    const optionMatch = resolveNamedElement(documents, optionTarget, { allowFileInput: false });
    if (!optionMatch?.element) {
      return null;
    }
    return {
      mapping: {
        ...mapping,
        fieldType: 'checkbox',
        target: optionTarget,
        options: [option],
      },
      targetMatch: optionMatch,
    };
  }).filter(Boolean);
  return expanded.length > 0
    ? expanded
    : [{
        mapping,
        targetMatch: originalMatch,
      }];
};
const collectChoiceClickTargets = (choiceRoot) => {
  if (!choiceRoot) {
    return [];
  }
  const selectors = [
    '[role="checkbox"]',
    '[role="radio"]',
    'input[type="checkbox"]',
    'input[type="radio"]',
    'label',
    'button',
    '[class*="icon"]',
    '[class*="check"]',
    '[class*="radio"]',
    '[class*="option"]',
    '[class*="choice"]',
    '.field-content',
    '.field-content-wrapper',
  ];
  const results = [];
  const seen = new Set();
  selectors.forEach((selector) => {
    const matched = choiceRoot.querySelector?.(selector);
    if (!matched || seen.has(matched)) {
      return;
    }
    results.push(matched);
    seen.add(matched);
  });
  const titleNode = findSemanticTitleNode(choiceRoot);
  [titleNode, choiceRoot].filter(Boolean).forEach((item) => {
    if (seen.has(item)) {
      return;
    }
    results.push(item);
    seen.add(item);
  });
  return results;
};
const readChoiceCheckedState = (choiceRoot) => {
  if (!choiceRoot) {
    return false;
  }
  const checkboxRoot = choiceRoot;
  const nativeInput = checkboxRoot?.matches?.('input[type="checkbox"], input[type="radio"]')
    ? checkboxRoot
    : checkboxRoot?.querySelector?.('input[type="checkbox"], input[type="radio"]');
  if (nativeInput && typeof nativeInput.checked === 'boolean') {
    return Boolean(nativeInput.checked);
  }
  const ariaChecked = normalizeText(
    checkboxRoot?.getAttribute?.('aria-checked')
    || nativeInput?.getAttribute?.('aria-checked'),
  ).toLowerCase();
  if (ariaChecked === 'true') {
    return true;
  }
  if (ariaChecked === 'false') {
    return false;
  }
  const iconCandidates = [
    checkboxRoot,
    ...Array.from(checkboxRoot?.querySelectorAll?.('[class*="icon"], [class*="check"], [class*="radio"], [class*="choice"]') || []),
  ].filter(Boolean);
  for (const iconCandidate of iconCandidates) {
    const iconClass = normalizeText(iconCandidate?.getAttribute?.('class')).toLowerCase();
    if (!iconClass) {
      continue;
    }
    if (checkedKeywords.includes(iconClass) || /(xuanzhong|checked|selected|active|on)\b/i.test(iconClass)) {
      return true;
    }
    if (uncheckedKeywords.includes(iconClass) || /(moren|unchecked|unselected|inactive|off|default)\b/i.test(iconClass)) {
      return false;
    }
  }
  const checkboxClass = normalizeText([
    checkboxRoot?.getAttribute?.('class'),
    checkboxRoot?.getAttribute?.('data-state'),
    checkboxRoot?.getAttribute?.('aria-pressed'),
  ].filter(Boolean).join(' ')).toLowerCase();
  if (checkedKeywords.includes(checkboxClass) || /(checked|selected|active|on)\b/i.test(checkboxClass)) {
    return true;
  }
  if (uncheckedKeywords.includes(checkboxClass) || /(unchecked|unselected|inactive|off|default)\b/i.test(checkboxClass)) {
    return false;
  }
  return false;
};
const triggerChoiceClick = (target) => {
  if (!target) {
    return;
  }
  const ownerWindow = target?.ownerDocument?.defaultView || window;
  if ('focus' in target && typeof target.focus === 'function') {
    target.focus();
  }
  if (typeof target.click === 'function') {
    target.click();
    return;
  }
  target.dispatchEvent(new ownerWindow.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const fillMappedField = async (target, resolvedValue, mapping) => {
  if (!target) {
    return false;
  }
  const componentRoot = findSemanticFieldRoot(target) || target;
  const editableTarget = resolveEditableTarget(target);
  const tagName = normalizeText(editableTarget?.tagName || target.tagName).toLowerCase();
  const inputType = normalizeText(
    editableTarget?.type
    || editableTarget?.getAttribute?.('type')
    || target.type
    || target.getAttribute?.('type')
    || mapping?.fieldType,
  ).toLowerCase();
  if ('focus' in editableTarget && typeof editableTarget.focus === 'function') {
    editableTarget.focus();
  }
  if (tagName === 'select') {
    const choices = splitChoiceValues(resolvedValue);
    const optionElements = Array.from(editableTarget.options || []);
    let matchedCount = 0;
    if (editableTarget.multiple) {
      optionElements.forEach((optionElement) => {
        const shouldSelect = choices.length > 0
          && aliasesMatchChoices(collectMappedOptionAliases(optionElement, mapping?.options), choices);
        optionElement.selected = shouldSelect;
        if (shouldSelect) {
          matchedCount += 1;
        }
      });
    } else {
      const matchedOption = optionElements.find((optionElement) =>
        choices.length > 0
          && aliasesMatchChoices(collectMappedOptionAliases(optionElement, mapping?.options), choices));
      if (matchedOption) {
        editableTarget.value = matchedOption.value;
        matchedCount = 1;
      } else {
        editableTarget.value = normalizeValue(resolvedValue);
        matchedCount = normalizeText(editableTarget.value) ? 1 : 0;
      }
    }
    dispatchFieldEvents(editableTarget);
    return matchedCount > 0;
  }
  if (
    inputType === 'checkbox'
    || inputType === 'radio'
    || mapping?.fieldType === 'checkbox'
    || mapping?.fieldType === 'radio'
    || (
      isChoiceLikeElement(componentRoot)
      && (
        isChoiceLikeFieldType(mapping?.fieldType)
        || (Array.isArray(mapping?.options) && mapping.options.length > 0)
      )
    )
  ) {
    const normalizedType = inputType === 'radio' || mapping?.fieldType === 'radio' ? 'radio' : 'checkbox';
    const choiceRoot = isChoiceLikeElement(componentRoot) ? componentRoot : null;
    if (choiceRoot) {
      const choices = splitChoiceValues(resolvedValue);
      const aliases = Array.from(new Set([
        ...collectElementAliases(choiceRoot),
        ...(Array.isArray(mapping?.options) ? mapping.options.flatMap((option) => collectOptionAliases(option)) : []),
      ]));
      const shouldCheck = choices.length === 0
        ? Boolean(resolvedValue)
        : aliasesMatchChoices(aliases, choices);
      if (readChoiceCheckedState(choiceRoot) === shouldCheck) {
        dispatchFieldEvents(choiceRoot);
        return shouldCheck;
      }
      const clickTargets = collectChoiceClickTargets(choiceRoot);
      for (const clickTarget of clickTargets) {
        triggerChoiceClick(clickTarget);
        dispatchFieldEvents(clickTarget || choiceRoot);
        dispatchFieldEvents(choiceRoot);
        await wait(50);
        if (readChoiceCheckedState(choiceRoot) === shouldCheck) {
          return shouldCheck;
        }
      }
      return false;
    }
    const group = resolveChoiceGroup(target, normalizedType);
    const choices = splitChoiceValues(resolvedValue);
    let matchedCount = 0;
    group.forEach((element) => {
      const aliases = Array.from(new Set([
        ...collectElementAliases(element),
        ...(Array.isArray(mapping?.options) ? mapping.options.flatMap((option) => collectOptionAliases(option)) : []),
      ]));
      const shouldCheck = choices.length === 0
        ? Boolean(resolvedValue)
        : aliasesMatchChoices(aliases, choices);
      const nextChecked = normalizedType === 'radio'
        ? shouldCheck && matchedCount === 0
        : shouldCheck;
      element.checked = nextChecked;
      if (nextChecked) {
        matchedCount += 1;
      }
      dispatchFieldEvents(element);
    });
    return matchedCount > 0;
  }
  if (mapping?.fieldType === 'file' && isAttachmentLikeElement(componentRoot)) {
    dispatchFieldEvents(componentRoot);
    return true;
  }
  const nextValue = normalizeValue(resolvedValue);
  if ('value' in editableTarget) {
    editableTarget.value = nextValue;
  } else {
    editableTarget.textContent = nextValue;
  }
  dispatchFieldEvents(editableTarget);
  return Boolean(nextValue);
};
const resolveTriggerElement = (trigger, rootDocuments, frameDocuments) => {
  const candidates = trigger?.scope === 'root'
    ? rootDocuments
    : trigger?.scope === 'frame'
      ? frameDocuments
      : [...frameDocuments, ...rootDocuments].filter(Boolean);
  for (const entry of candidates) {
    const scope = entry?.document;
    if (!scope) {
      continue;
    }
    if (trigger?.selector) {
      const selectorMatch = scope.querySelector(trigger.selector);
      if (selectorMatch) {
        return { element: selectorMatch, document: scope, window: entry.window };
      }
    }
  }
  const expectedText = normalizeText(trigger?.text);
  if (!expectedText) {
    return null;
  }
  const exact = trigger?.exact !== false;
  for (const entry of candidates) {
    const scope = entry?.document;
    const nodes = Array.from(scope.querySelectorAll('button, a, span, div, input')).filter((element) => {
      const text = normalizeText(
        ('value' in element && typeof element.value === 'string' ? element.value : '')
        || element.textContent
        || element.getAttribute('title')
        || element.getAttribute('aria-label')
        || ''
      );
      return exact ? text === expectedText : false;
    });
    if (nodes[0]) {
      return { element: nodes[0], document: scope, window: entry.window };
    }
  }
  return null;
};
const ensureCaptureStore = (windows, actionPattern) => {
  const pattern = actionPattern ? new RegExp(String(actionPattern), 'i') : null;
  const store = window.__uniflowSubmitCaptureStore || {
    events: [],
    matches: [],
  };
  window.__uniflowSubmitCaptureStore = store;
  for (const currentWindow of windows) {
    if (currentWindow.__uniflowSubmitCaptureStoreInstalled) {
      currentWindow.__uniflowSubmitCaptureStore = store;
      continue;
    }
    const originalSubmit = currentWindow.HTMLFormElement?.prototype?.submit;
    const originalRequestSubmit = currentWindow.HTMLFormElement?.prototype?.requestSubmit;
    const originalFetch = currentWindow.fetch?.bind(currentWindow);
    const originalOpen = currentWindow.XMLHttpRequest?.prototype?.open;
    const originalSend = currentWindow.XMLHttpRequest?.prototype?.send;
    const originalSetRequestHeader = currentWindow.XMLHttpRequest?.prototype?.setRequestHeader;
    const recordRequest = (record) => {
      store.events.push(record);
      if (shouldMatchCaptureRecord(record, pattern)) {
        store.matches.push(record);
        return true;
      }
      return false;
    };
    const recordSubmission = function (form) {
      const ownerWindow = form?.ownerDocument?.defaultView || currentWindow;
      const enctype = normalizeText(form?.getAttribute?.('enctype') || form?.enctype || '').toLowerCase();
      const formData = new ownerWindow.FormData(form);
      const record = createSubmitRecord({
        type: 'form.submit',
        action: form?.getAttribute?.('action') || form?.action || ownerWindow.location?.href || '',
        method: normalizeText(form?.getAttribute?.('method') || form?.method || 'post').toLowerCase(),
        body: formData,
        enctype,
        ownerWindow,
      });
      recordRequest(record);
    };
    currentWindow.HTMLFormElement.prototype.submit = function () {
      recordSubmission(this);
      return undefined;
    };
    currentWindow.HTMLFormElement.prototype.requestSubmit = function (submitter) {
      recordSubmission(this);
      if (typeof originalRequestSubmit === 'function') {
        return originalRequestSubmit.call(this, submitter);
      }
      return undefined;
    };
    if (typeof originalFetch === 'function') {
      currentWindow.fetch = async function (input, init) {
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input?.url;
        const requestHeaders = normalizeHeaders(init?.headers || input?.headers);
        let requestBody = init?.body;
        if (requestBody === undefined && typeof Request !== 'undefined' && input instanceof Request) {
          try {
            requestBody = await input.clone().text();
          } catch {
            requestBody = undefined;
          }
        }
        const record = createSubmitRecord({
          type: 'fetch',
          action: requestUrl,
          method: init?.method || input?.method || 'GET',
          headers: requestHeaders,
          body: requestBody,
          ownerWindow: currentWindow,
        });
        const matched = recordRequest(record);
        if (matched) {
          const stub = createStubResponsePayload(record);
          return new currentWindow.Response(stub.body, {
            status: 200,
            headers: {
              'Content-Type': stub.contentType,
            },
          });
        }
        return originalFetch(input, init);
      };
    }
    if (typeof originalOpen === 'function' && typeof originalSend === 'function') {
      currentWindow.XMLHttpRequest.prototype.open = function (method, url) {
        this.__uniflowRequestMeta = {
          method: normalizeText(method || 'GET') || 'GET',
          url: String(url || ''),
          headers: {},
        };
        return originalOpen.apply(this, arguments);
      };
      currentWindow.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        const meta = this.__uniflowRequestMeta || { headers: {} };
        meta.headers = meta.headers || {};
        meta.headers[String(name || '').toLowerCase()] = String(value || '');
        this.__uniflowRequestMeta = meta;
        if (typeof originalSetRequestHeader === 'function') {
          return originalSetRequestHeader.apply(this, arguments);
        }
        return undefined;
      };
      currentWindow.XMLHttpRequest.prototype.send = function (body) {
        const meta = this.__uniflowRequestMeta || {};
        const record = createSubmitRecord({
          type: 'xhr',
          action: meta.url || '',
          method: meta.method || 'GET',
          headers: meta.headers || {},
          body,
          ownerWindow: currentWindow,
        });
        const matched = recordRequest(record);
        if (!matched) {
          return originalSend.apply(this, arguments);
        }
        const stub = createStubResponsePayload(record);
        try {
          Object.defineProperty(this, 'readyState', { configurable: true, value: 4 });
          Object.defineProperty(this, 'status', { configurable: true, value: 200 });
          Object.defineProperty(this, 'responseURL', { configurable: true, value: record.action || '' });
          Object.defineProperty(this, 'responseText', { configurable: true, value: stub.body });
          Object.defineProperty(this, 'response', { configurable: true, value: stub.body });
        } catch {
          // ignore readonly property failures
        }
        currentWindow.setTimeout(() => {
          try {
            const readyStateEvent = new currentWindow.Event('readystatechange');
            this.onreadystatechange?.(readyStateEvent);
            this.dispatchEvent?.(readyStateEvent);
            const loadEvent = new currentWindow.ProgressEvent('load');
            this.onload?.(loadEvent);
            this.dispatchEvent?.(loadEvent);
            const loadEndEvent = new currentWindow.ProgressEvent('loadend');
            this.onloadend?.(loadEndEvent);
            this.dispatchEvent?.(loadEndEvent);
          } catch {
            // ignore event dispatch failures
          }
        }, 0);
        return undefined;
      };
    }
    currentWindow.__uniflowSubmitCaptureStoreInstalled = true;
    currentWindow.__uniflowSubmitCaptureStore = store;
    currentWindow.__uniflowSubmitCaptureStoreRestore = () => {
      if (typeof originalSubmit === 'function') {
        currentWindow.HTMLFormElement.prototype.submit = originalSubmit;
      }
      if (typeof originalRequestSubmit === 'function') {
        currentWindow.HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
      }
      if (typeof originalFetch === 'function') {
        currentWindow.fetch = originalFetch;
      }
      if (typeof originalOpen === 'function') {
        currentWindow.XMLHttpRequest.prototype.open = originalOpen;
      }
      if (typeof originalSend === 'function') {
        currentWindow.XMLHttpRequest.prototype.send = originalSend;
      }
      if (typeof originalSetRequestHeader === 'function') {
        currentWindow.XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
      }
      currentWindow.__uniflowSubmitCaptureStoreInstalled = false;
    };
  }
  return store;
};

const options = context.step?.options || {};
const output = options.output || {};
const captureKey = output.captureKey || 'submitCapture';
const fieldsKey = output.fieldsKey || 'submitFields';
const csrfKey = output.csrfKey || 'csrfToken';
const filledFieldsKey = output.filledFieldsKey || 'filledFields';
const captureEventCountKey = output.captureEventCountKey || 'captureEventCount';
const bodyModeKey = output.bodyModeKey || 'submitBodyMode';
const originKey = output.originKey || 'submitOrigin';
const attachmentFieldMapKey = output.attachmentFieldMapKey || 'attachmentFieldMap';
const headersKey = output.headersKey || 'submitRequestHeaders';
const rawBodyKey = output.rawBodyKey || 'submitRawBody';
const resolvedFieldBindingsKey = output.resolvedFieldBindingsKey || 'resolvedFieldBindings';
const resolvedFieldMappingsKey = output.resolvedFieldMappingsKey || 'resolvedFieldMappings';
const rootDocuments = getAccessibleDocuments().filter((entry) => entry.document === document);
const frameDocuments = resolveDocuments(options.frame);
const allWindows = getAccessibleWindows();
const captureStore = ensureCaptureStore(allWindows, options.capture?.actionPattern);
const previousMatchCount = captureStore.matches.length;
const previousEventCount = captureStore.events.length;
const fieldMappings = Array.isArray(options.fieldMappings) ? options.fieldMappings : [];
const fileMappings = Array.isArray(options.fileMappings) ? options.fileMappings : [];
const filledFields = {};
const attachmentFieldMap = {};
const resolvedFieldBindings = [];
const resolvedFieldBindingIndex = {};
const resolvedFieldMappings = [];
const upsertResolvedFieldBinding = (binding) => {
  if (!binding || typeof binding !== 'object') {
    return;
  }
  const fieldKey = normalizeText(binding.key || binding.fieldKey);
  if (!fieldKey) {
    return;
  }
  const existingIndex = resolvedFieldBindingIndex[fieldKey];
  const nextBinding = Object.fromEntries(Object.entries({
    ...(fieldKey ? { key: fieldKey } : {}),
    ...binding,
  }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  if (existingIndex === undefined) {
    resolvedFieldBindingIndex[fieldKey] = resolvedFieldBindings.length;
    resolvedFieldBindings.push(nextBinding);
    return;
  }
  resolvedFieldBindings[existingIndex] = {
    ...resolvedFieldBindings[existingIndex],
    ...nextBinding,
  };
};

for (const mapping of fieldMappings) {
  const executableMappings = resolveExecutableMappings(
    frameDocuments.length > 0 ? frameDocuments : rootDocuments,
    mapping,
  );
  for (const executable of executableMappings) {
    const nextMapping = executable?.mapping || mapping;
    const targetMatch = executable?.targetMatch || resolveNamedElement(
      frameDocuments.length > 0 ? frameDocuments : rootDocuments,
      nextMapping?.target,
      { allowFileInput: false },
    );
    const target = targetMatch?.element;
    const targetKey = nextMapping?.target?.id
      || nextMapping?.target?.name
      || nextMapping?.target?.label
      || nextMapping?.target?.selector
      || nextMapping?.fieldKey
      || 'unknown';
    const fieldKey = normalizeText(nextMapping?.fieldKey || '');
    const resolvedValue = resolveSourceValue(nextMapping);
    if (fieldKey && filledFields[fieldKey] === undefined) {
      filledFields[fieldKey] = false;
    }
    if (!target || resolvedValue === undefined || resolvedValue === null) {
      filledFields[targetKey] = false;
      continue;
    }
    const resolvedTarget = buildResolvedTargetDescriptor(target, nextMapping?.target, nextMapping);
    if (resolvedTarget?.descriptor) {
      resolvedFieldMappings.push({
        ...nextMapping,
        target: resolvedTarget.descriptor,
      });
    }
    if (resolvedTarget?.binding) {
      upsertResolvedFieldBinding(resolvedTarget.binding);
    }
    const filled = await fillMappedField(target, resolvedValue, nextMapping);
    filledFields[targetKey] = filled;
    if (fieldKey) {
      filledFields[fieldKey] = Boolean(filledFields[fieldKey]) || filled;
    }
  }
}

for (const mapping of fileMappings) {
  const targetMatch = resolveNamedElement(
    frameDocuments.length > 0 ? frameDocuments : rootDocuments,
    mapping?.target,
    {
      allowFileInput: true,
      expectAttachmentComponent: true,
    },
  );
  const target = targetMatch?.element;
  const componentRoot = findSemanticFieldRoot(target) || target;
  const requestFieldName = normalizeText(
    componentRoot?.getAttribute?.('name')
    || componentRoot?.getAttribute?.('id')
    || target?.getAttribute?.('name')
    || target?.getAttribute?.('id')
    || '',
  );
  const fieldKey = normalizeText(mapping?.fieldKey || mapping?.source || '');
  const resolvedTarget = target
    ? buildResolvedTargetDescriptor(target, mapping?.target, {
        ...mapping,
        fieldType: mapping?.fieldType || 'file',
      })
    : null;
  if (resolvedTarget?.descriptor) {
    resolvedFieldMappings.push({
      ...mapping,
      target: resolvedTarget.descriptor,
    });
  }
  if (resolvedTarget?.binding) {
    upsertResolvedFieldBinding({
      ...resolvedTarget.binding,
      ...(requestFieldName ? { requestFieldName } : {}),
      ...(fieldKey ? { key: fieldKey } : {}),
      type: 'file',
    });
  }
  if (fieldKey && requestFieldName) {
    attachmentFieldMap[fieldKey] = requestFieldName;
  }
  if (fieldKey) {
    filledFields[fieldKey] = Boolean(target);
  }
  if (mapping?.target?.label) {
    filledFields[mapping.target.label] = Boolean(target);
  }
}

await wait(Number(options.beforeTriggerDelayMs || 500));
const triggerMatch = resolveTriggerElement(options.trigger, rootDocuments, frameDocuments);
const trigger = triggerMatch?.element;
if (!trigger) {
  throw new Error('Configured submit trigger not found');
}
if (typeof trigger.click === 'function') {
  trigger.click();
} else {
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

const timeoutMs = Number(options.capture?.timeoutMs || 10000);
const startedAt = Date.now();
while (captureStore.matches.length <= previousMatchCount) {
  if (Date.now() - startedAt > timeoutMs) {
    if (captureStore.events.length > previousEventCount) {
      break;
    }
    throw new Error('Timed out waiting for form submit capture');
  }
  await wait(250);
}
const settleDelayMs = Math.max(250, Math.min(Number(options.capture?.settleDelayMs || 1200), 4000));
await wait(settleDelayMs);
const matched = pickBestCapturedRequest(
  (
    captureStore.matches.length > previousMatchCount
      ? captureStore.matches.slice(previousMatchCount)
      : captureStore.events.slice(previousEventCount)
  ),
  options.capture?.actionPattern ? new RegExp(String(options.capture.actionPattern), 'i') : null,
) || captureStore.matches[captureStore.matches.length - 1];
return {
  [csrfKey]: matched?.fields?.CSRFTOKEN ?? '',
  [captureKey]: matched,
  [fieldsKey]: matched?.fields || {},
  [filledFieldsKey]: filledFields,
  [captureEventCountKey]: Array.isArray(captureStore.events) ? captureStore.events.length : 0,
  [bodyModeKey]: matched?.bodyMode || 'form',
  [originKey]: matched?.origin || '',
  [attachmentFieldMapKey]: attachmentFieldMap,
  [headersKey]: matched?.headers || {},
  [rawBodyKey]: matched?.rawBody || '',
  [resolvedFieldBindingsKey]: resolvedFieldBindings,
  [resolvedFieldMappingsKey]: resolvedFieldMappings,
};
`.trim();

export class BrowserEvaluateBuiltinRegistry {
  resolve(step: RpaStepDefinition) {
    switch (step.builtin) {
      case 'capture_form_submit':
        return CAPTURE_FORM_SUBMIT_SCRIPT;
      default:
        throw new Error(`Unsupported browser evaluate builtin: ${String(step.builtin || '')}`);
    }
  }
}
