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
  const labelNode = element.closest('label')
    || (element.id ? element.ownerDocument.querySelector('label[for="' + element.id + '"]') : null)
    || element.parentElement?.querySelector?.('label')
    || null;
  return normalizeText(
    labelNode?.textContent
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
const resolveNamedElement = (documents, target, options = {}) => {
  if (!Array.isArray(documents) || !target || typeof target !== 'object') {
    return null;
  }
  const allowFileInput = options.allowFileInput !== false;
  for (const entry of documents) {
    const doc = entry.document;
    if (!doc) {
      continue;
    }
    if (target.selector) {
      const selectorMatch = doc.querySelector(target.selector);
      if (selectorMatch && (allowFileInput || !isFileInputElement(selectorMatch))) {
        return { element: selectorMatch, document: doc, window: entry.window };
      }
    }
    if (target.id) {
      const idMatch = doc.getElementById(target.id);
      if (idMatch && (allowFileInput || !isFileInputElement(idMatch))) {
        return { element: idMatch, document: doc, window: entry.window };
      }
    }
    if (target.name) {
      const nameMatch = doc.getElementsByName(target.name)?.[0] || null;
      if (nameMatch && (allowFileInput || !isFileInputElement(nameMatch))) {
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
    const field = Array.from(doc.querySelectorAll('input, textarea, select')).find((element) => {
      if (!allowFileInput && isFileInputElement(element)) {
        return false;
      }
      return extractElementLabel(element).includes(expectedLabel);
    });
    if (field) {
      return { element: field, document: doc, window: entry.window };
    }
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
    const recordSubmission = function (form) {
      const ownerWindow = form?.ownerDocument?.defaultView || currentWindow;
      const enctype = normalizeText(form?.getAttribute?.('enctype') || form?.enctype || '').toLowerCase();
      const formData = new ownerWindow.FormData(form);
      const fields = Object.fromEntries(
        Array.from(formData.entries()).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : value.name,
        ]),
      );
      const action = toAbsoluteUrl(form?.getAttribute?.('action') || form?.action || ownerWindow.location?.href || '');
      const record = {
        type: 'form.submit',
        action,
        method: normalizeText(form?.getAttribute?.('method') || form?.method || 'post').toLowerCase(),
        fields,
        enctype,
        bodyMode: enctype.includes('multipart/form-data') ? 'multipart' : 'form',
        origin: (() => {
          try {
            return new URL(action || ownerWindow.location?.href || ownerWindow.location?.origin || '', ownerWindow.location?.href || window.location.href).origin;
          } catch {
            return normalizeText(ownerWindow.location?.origin || '');
          }
        })(),
      };
      store.events.push(record);
      if (!pattern || pattern.test(record.action)) {
        store.matches.push(record);
      }
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
    currentWindow.__uniflowSubmitCaptureStoreInstalled = true;
    currentWindow.__uniflowSubmitCaptureStore = store;
    currentWindow.__uniflowSubmitCaptureStoreRestore = () => {
      if (typeof originalSubmit === 'function') {
        currentWindow.HTMLFormElement.prototype.submit = originalSubmit;
      }
      if (typeof originalRequestSubmit === 'function') {
        currentWindow.HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
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
  const resolvedValue = resolveSourceValue(mapping);
  if (!target || resolvedValue === undefined || resolvedValue === null) {
    filledFields[targetKey] = false;
    continue;
  }
  const nextValue = normalizeValue(resolvedValue);
  if ('focus' in target && typeof target.focus === 'function') {
    target.focus();
  }
  if ('value' in target) {
    target.value = nextValue;
  } else {
    target.textContent = nextValue;
  }
  ['input', 'change', 'blur'].forEach((eventName) => {
    target.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
  filledFields[targetKey] = true;
}

for (const mapping of fileMappings) {
  const targetMatch = resolveNamedElement(
    frameDocuments.length > 0 ? frameDocuments : rootDocuments,
    mapping?.target,
    { allowFileInput: true },
  );
  const target = targetMatch?.element;
  const requestFieldName = normalizeText(target?.getAttribute?.('name') || target?.getAttribute?.('id') || '');
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
