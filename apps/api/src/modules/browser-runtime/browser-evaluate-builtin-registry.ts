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
const resolveNamedElement = (doc, target) => {
  if (!doc || !target || typeof target !== 'object') {
    return null;
  }
  if (target.selector) {
    return doc.querySelector(target.selector);
  }
  if (target.id) {
    return doc.getElementById(target.id);
  }
  if (target.name) {
    return doc.getElementsByName(target.name)?.[0] || null;
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
const resolveFrameDocument = (frameOptions) => {
  if (!frameOptions || typeof frameOptions !== 'object') {
    return document;
  }
  const iframe = frameOptions.selector
    ? document.querySelector(frameOptions.selector)
    : frameOptions.name
      ? document.querySelector('iframe[name="' + frameOptions.name + '"], iframe#' + frameOptions.name)
      : null;
  const frameDocument = iframe?.contentWindow?.document;
  if (!frameDocument) {
    throw new Error('Configured iframe target is not ready');
  }
  return frameDocument;
};
const resolveTriggerElement = (trigger, frameDocument) => {
  const scope = trigger?.scope === 'frame' ? frameDocument : document;
  if (!scope) {
    return null;
  }
  if (trigger?.selector) {
    return scope.querySelector(trigger.selector);
  }
  const expectedText = normalizeText(trigger?.text);
  if (!expectedText) {
    return null;
  }
  const exact = trigger?.exact !== false;
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
  return nodes[0] || null;
};
const ensureCaptureStore = (actionPattern) => {
  const pattern = actionPattern ? new RegExp(String(actionPattern), 'i') : null;
  const store = window.__uniflowSubmitCaptureStore || {
    events: [],
    matches: [],
  };
  if (!window.__uniflowSubmitCaptureStoreInstalled) {
    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      const fields = Object.fromEntries(
        Array.from(new FormData(this).entries()).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : value.name,
        ]),
      );
      const record = {
        type: 'form.submit',
        action: toAbsoluteUrl(this.getAttribute('action') || this.action || ''),
        method: normalizeText(this.getAttribute('method') || this.method || 'post').toLowerCase(),
        fields,
      };
      store.events.push(record);
      if (!pattern || pattern.test(record.action)) {
        store.matches.push(record);
      }
      return undefined;
    };
    window.__uniflowSubmitCaptureStoreInstalled = true;
    window.__uniflowSubmitCaptureStore = store;
    window.__uniflowSubmitCaptureStoreRestore = () => {
      HTMLFormElement.prototype.submit = originalSubmit;
      window.__uniflowSubmitCaptureStoreInstalled = false;
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
const frameDocument = resolveFrameDocument(options.frame);
const captureStore = ensureCaptureStore(options.capture?.actionPattern);
const previousMatchCount = captureStore.matches.length;
const fieldMappings = Array.isArray(options.fieldMappings) ? options.fieldMappings : [];
const filledFields = {};

for (const mapping of fieldMappings) {
  const target = resolveNamedElement(frameDocument, mapping?.target);
  const targetKey = mapping?.target?.id || mapping?.target?.name || mapping?.target?.selector || mapping?.fieldKey || 'unknown';
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

await wait(Number(options.beforeTriggerDelayMs || 500));
const trigger = resolveTriggerElement(options.trigger, frameDocument);
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
