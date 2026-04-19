import type { RpaStepDefinition } from '@uniflow/shared-types';

const CAPTURE_FORM_SUBMIT_SCRIPT = String.raw`
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readPath = (input, path) => String(path || '')
  .split('.')
  .filter(Boolean)
  .reduce((current, key) => current?.[key], input);
const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
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
const extractElementLabel = (element) => {
  if (!element) {
    return '';
  }
  const capTitle = element.closest?.('.cap-field, .cap4-checkbox, .cap4-attach, .cap4-textarea, .cap4-input');
  const capFieldTitle = capTitle?.querySelector?.('.field-title, .cap4-attach__left, .cap4-checkbox__left, .cap4-textarea__left, .cap4-input__left');
  const labelNode = element.closest('label')
    || (element.id ? element.ownerDocument.querySelector('label[for="' + element.id + '"]') : null)
    || element.parentElement?.querySelector?.('label')
    || null;
  return normalizeText(
    capFieldTitle?.textContent
    || capTitle?.getAttribute?.('title')
    || labelNode?.textContent
    || element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
    || element.getAttribute?.('placeholder')
    || element.getAttribute?.('name')
    || element.getAttribute?.('id')
    || ''
  );
};
const isFileInputElement = (element) => {
  if (!element) {
    return false;
  }
  const typeAttr = normalizeText(element.getAttribute?.('type') || '');
  const typeProp = normalizeText(element.type || '');
  return typeAttr.toLowerCase() === 'file' || typeProp.toLowerCase() === 'file';
};
const isCapAttachmentElement = (element) => Boolean(
  element?.matches?.('.cap4-attach, .cap4-attach__cnt, .cap4-attach__picker, [class*="cap4-attach"]')
  || element?.closest?.('.cap4-attach, [class*="cap4-attach"]'),
);
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
const shouldMatchCaptureRecord = (record, pattern) => {
  if (!pattern) {
    return true;
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
        && (!expectAttachmentComponent || isCapAttachmentElement(selectorMatch))
      ) {
        return { element: selectorMatch, document: doc, window: entry.window };
      }
    }
    if (target.id) {
      const idMatch = doc.getElementById(target.id);
      if (
        idMatch
        && (allowFileInput || !isFileInputElement(idMatch))
        && (!expectAttachmentComponent || isCapAttachmentElement(idMatch))
      ) {
        return { element: idMatch, document: doc, window: entry.window };
      }
    }
    if (target.name) {
      const nameMatch = doc.getElementsByName(target.name)?.[0] || null;
      if (
        nameMatch
        && (allowFileInput || !isFileInputElement(nameMatch))
        && (!expectAttachmentComponent || isCapAttachmentElement(nameMatch))
      ) {
        return { element: nameMatch, document: doc, window: entry.window };
      }
    }
  }
  const expectedLabel = normalizeText(target.label || target.text || target.placeholder || '');
  if (!expectedLabel) {
    return null;
  }
  for (const entry of documents) {
    const doc = entry.document;
    const selector = expectAttachmentComponent
      ? '.cap4-attach, .cap4-attach__cnt, .cap4-attach__picker, [class*="cap4-attach"]'
      : 'input, textarea, select, .cap-field, .cap4-checkbox, .cap4-textarea, .cap4-input';
    const field = Array.from(doc.querySelectorAll(selector)).find((element) => {
      if (!allowFileInput && isFileInputElement(element)) {
        return false;
      }
      if (expectAttachmentComponent && !isCapAttachmentElement(element)) {
        return false;
      }
      return extractElementLabel(element).includes(expectedLabel);
    });
    if (field) {
      return { element: field, document: doc, window: entry.window };
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
      if (directMeta.includes(expectedLabel)) {
        score += 8;
      }
      if (nearbyText.includes(expectedLabel)) {
        score += 6;
      }
      if (/附件|上传|file|attach|upload/i.test(expectedLabel)) {
        if (/附件|上传|file|attach|upload/i.test(directMeta)) {
          score += 4;
        }
        if (/附件|上传|file|attach|upload/i.test(nearbyText)) {
          score += 3;
        }
      }
      if (fileInputs.length === 1) {
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
  const componentRoot = element.closest?.('.cap-field, .cap4-checkbox, .cap4-attach, .cap4-input, .cap4-textarea') || element;
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
  aliases.some((alias) => alias === choice || alias.includes(choice) || choice.includes(alias)));
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
const collectCapCheckboxClickTargets = (capCheckboxRoot) => {
  if (!capCheckboxRoot) {
    return [];
  }
  const selectors = [
    '.cap4-checkbox__icon',
    '.cap4-checkbox__icon .icon',
    '.cap4-checkbox__cnt',
    '.field-content',
    '.field-content-wrapper',
    '.cap4-checkbox__right',
    '.cap4-checkbox__left',
    '.cap4-checkbox',
  ];
  const results = [];
  const seen = new Set();
  selectors.forEach((selector) => {
    const matched = capCheckboxRoot.querySelector?.(selector);
    if (!matched || seen.has(matched)) {
      return;
    }
    results.push(matched);
    seen.add(matched);
  });
  const rootCheckbox = capCheckboxRoot.matches?.('.cap4-checkbox')
    ? capCheckboxRoot
    : capCheckboxRoot.querySelector?.('.cap4-checkbox');
  [rootCheckbox, capCheckboxRoot].filter(Boolean).forEach((item) => {
    if (seen.has(item)) {
      return;
    }
    results.push(item);
    seen.add(item);
  });
  return results;
};
const readCapCheckboxCheckedState = (capCheckboxRoot) => {
  if (!capCheckboxRoot) {
    return false;
  }
  const checkboxRoot = capCheckboxRoot.matches?.('.cap4-checkbox')
    ? capCheckboxRoot
    : capCheckboxRoot.querySelector?.('.cap4-checkbox') || capCheckboxRoot;
  const icon = checkboxRoot?.querySelector?.('.cap4-checkbox__icon .icon')
    || checkboxRoot?.querySelector?.('.cap4-checkbox__icon')
    || null;
  const ariaChecked = normalizeText(checkboxRoot?.getAttribute?.('aria-checked')).toLowerCase();
  if (ariaChecked === 'true') {
    return true;
  }
  if (ariaChecked === 'false') {
    return false;
  }
  const iconClass = normalizeText(icon?.getAttribute?.('class')).toLowerCase();
  if (/fuxuan[-_]?xuanzhong|checked|selected/.test(iconClass)) {
    return true;
  }
  if (/fuxuan[-_]?moren|unchecked|default/.test(iconClass)) {
    return false;
  }
  const checkboxClass = normalizeText(checkboxRoot?.getAttribute?.('class')).toLowerCase();
  if (/\bis-checked\b|\bchecked\b|\bselected\b/.test(checkboxClass)) {
    return true;
  }
  return false;
};
const triggerCapCheckboxClick = (target) => {
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
  const componentRoot = target.closest?.('.cap-field, .cap4-checkbox, .cap4-attach, .cap4-textarea, .cap4-input') || target;
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
  if (inputType === 'checkbox' || inputType === 'radio' || mapping?.fieldType === 'checkbox' || mapping?.fieldType === 'radio') {
    const normalizedType = inputType === 'radio' || mapping?.fieldType === 'radio' ? 'radio' : 'checkbox';
    const capCheckboxRoot = componentRoot?.matches?.('.cap-field, .cap4-checkbox') ? componentRoot : null;
    if (capCheckboxRoot && capCheckboxRoot.querySelector?.('.cap4-checkbox__icon, .cap-icon-fuxuan-moren, .cap-icon-fuxuanxuanzhong')) {
      const choices = splitChoiceValues(resolvedValue);
      const aliases = Array.from(new Set([
        ...collectElementAliases(capCheckboxRoot),
        ...(Array.isArray(mapping?.options) ? mapping.options.flatMap((option) => collectOptionAliases(option)) : []),
      ]));
      const shouldCheck = choices.length === 0
        ? Boolean(resolvedValue)
        : aliasesMatchChoices(aliases, choices);
      if (readCapCheckboxCheckedState(capCheckboxRoot) === shouldCheck) {
        dispatchFieldEvents(capCheckboxRoot);
        return shouldCheck;
      }
      const clickTargets = collectCapCheckboxClickTargets(capCheckboxRoot);
      for (const clickTarget of clickTargets) {
        triggerCapCheckboxClick(clickTarget);
        dispatchFieldEvents(clickTarget || capCheckboxRoot);
        dispatchFieldEvents(capCheckboxRoot);
        await wait(50);
        if (readCapCheckboxCheckedState(capCheckboxRoot) === shouldCheck) {
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
  if (mapping?.fieldType === 'file' && isCapAttachmentElement(componentRoot)) {
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
      return exact ? text === expectedText : text.includes(expectedText);
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
const rootDocuments = getAccessibleDocuments().filter((entry) => entry.document === document);
const frameDocuments = resolveDocuments(options.frame);
const allWindows = getAccessibleWindows();
const captureStore = ensureCaptureStore(allWindows, options.capture?.actionPattern);
const previousMatchCount = captureStore.matches.length;
const fieldMappings = Array.isArray(options.fieldMappings) ? options.fieldMappings : [];
const fileMappings = Array.isArray(options.fileMappings) ? options.fileMappings : [];
const filledFields = {};
  const attachmentFieldMap = {};

for (const mapping of fieldMappings) {
  const targetMatch = resolveNamedElement(
    frameDocuments.length > 0 ? frameDocuments : rootDocuments,
    mapping?.target,
    { allowFileInput: false },
  );
  const target = targetMatch?.element;
  const targetKey = mapping?.target?.id || mapping?.target?.name || mapping?.target?.label || mapping?.target?.selector || mapping?.fieldKey || 'unknown';
  const fieldKey = normalizeText(mapping?.fieldKey || '');
  const resolvedValue = resolveSourceValue(mapping);
  if (fieldKey && filledFields[fieldKey] === undefined) {
    filledFields[fieldKey] = false;
  }
  if (!target || resolvedValue === undefined || resolvedValue === null) {
    filledFields[targetKey] = false;
    continue;
  }
  const filled = await fillMappedField(target, resolvedValue, mapping);
  filledFields[targetKey] = filled;
  if (fieldKey) {
    filledFields[fieldKey] = Boolean(filledFields[fieldKey]) || filled;
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
  const componentRoot = target?.closest?.('.cap-field, .cap4-attach') || target;
  const requestFieldName = normalizeText(
    componentRoot?.getAttribute?.('name')
    || componentRoot?.getAttribute?.('id')
    || target?.getAttribute?.('name')
    || target?.getAttribute?.('id')
    || '',
  );
  const fieldKey = normalizeText(mapping?.fieldKey || mapping?.source || '');
  if (fieldKey && requestFieldName) {
    attachmentFieldMap[fieldKey] = requestFieldName;
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
    throw new Error('Timed out waiting for form submit capture');
  }
  await wait(250);
}

const matched = captureStore.matches[captureStore.matches.length - 1];
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
