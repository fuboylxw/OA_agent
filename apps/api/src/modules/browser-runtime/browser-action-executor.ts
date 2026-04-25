import type { BrowserSnapshotElement, RpaStepDefinition } from '@uniflow/shared-types';
import type { RpaExecutedStep } from '../adapter-runtime/rpa-executor';
import { BrowserSecurityPolicy } from './browser-security-policy';
import { ElementRefCache } from './element-ref-cache';
import type { BrowserEngineAdapter } from './browser-engine-adapter';
import type { BrowserSessionRecord, BrowserTabRecord } from './browser-runtime.types';
import { BrowserEvaluateBuiltinRegistry } from './browser-evaluate-builtin-registry';
import {
  detectAuthCredentialFieldKind,
  resolveAuthCredentialValue,
} from '../common/auth-field.util';

export class BrowserActionExecutor {
  private readonly evaluateBuiltins = new BrowserEvaluateBuiltinRegistry();

  constructor(
    private readonly engine: BrowserEngineAdapter,
    private readonly refCache: ElementRefCache,
    private readonly securityPolicy: BrowserSecurityPolicy,
  ) {}

  async executeStep(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    step: RpaStepDefinition,
    index: number,
    snapshotId: string | undefined,
  ): Promise<{
    stepResult: RpaExecutedStep;
    extractedValues?: Record<string, any>;
    refreshSnapshot: boolean;
  }> {
    const resolvedStep = this.interpolateStep(step, tab.payload);
    this.securityPolicy.assertStepAllowed(resolvedStep);
    const element = this.requiresElement(resolvedStep.type)
      ? this.resolveElement(session.sessionId, tab.tabId, resolvedStep)
      : undefined;
    const value = this.resolveValue(resolvedStep, tab.payload);
    const effectiveAction = this.resolveEffectiveAction(resolvedStep, element, value);
    let extractedValues: Record<string, any> | undefined;

    switch (effectiveAction) {
      case 'goto':
        await this.engine.navigate(session, tab, this.resolveUrl(resolvedStep, tab));
        break;
      case 'wait':
        await this.engine.stabilize(session, tab, resolvedStep.timeoutMs);
        break;
      case 'input':
        await this.engine.input(session, tab, element, value);
        break;
      case 'select':
        await this.engine.select(session, tab, element, value);
        break;
      case 'click':
        await this.engine.click(session, tab, element, resolvedStep.target);
        break;
      case 'upload':
        await this.engine.upload(session, tab, element, value);
        if (resolvedStep.fieldKey) {
          const filledFields = (
            tab.extractedValues.filledFields
            && typeof tab.extractedValues.filledFields === 'object'
            && !Array.isArray(tab.extractedValues.filledFields)
          )
            ? tab.extractedValues.filledFields as Record<string, any>
            : {};
          filledFields[resolvedStep.fieldKey] = true;
          if (element?.label) {
            filledFields[element.label] = true;
          }
          tab.extractedValues.filledFields = filledFields;
        }
        break;
      case 'extract': {
        const extracted = await this.engine.extract(session, tab, element);
        const key = resolvedStep.fieldKey || 'lastExtracted';
        extractedValues = {
          [key]: extracted,
        };
        break;
      }
      case 'evaluate': {
        const evaluationScript = resolvedStep.script?.trim()
          || this.evaluateBuiltins.resolve(resolvedStep);
        const evaluated = await this.engine.evaluate(
          session,
          tab,
          evaluationScript,
          this.buildEvaluateContext(tab, resolvedStep, value),
        );
        extractedValues = this.normalizeEvaluateOutput(
          resolvedStep,
          evaluated,
          tab.extractedValues,
        );
        break;
      }
      case 'download': {
        const downloaded = await this.engine.download(session, tab, element);
        tab.artifacts.lastDownload = downloaded;
        break;
      }
      case 'screenshot': {
        const screenshot = await this.engine.screenshot(session, tab);
        tab.artifacts.lastScreenshot = screenshot;
        break;
      }
      default:
        throw new Error(`Unsupported browser step type: ${resolvedStep.type}`);
    }

    await this.engine.stabilize(session, tab, resolvedStep.timeoutMs);
    if (extractedValues) {
      Object.assign(tab.extractedValues, extractedValues);
    }
    return {
      stepResult: this.buildStepResult(resolvedStep, index, snapshotId, element, value, 'executed'),
      extractedValues,
      refreshSnapshot: resolvedStep.type !== 'wait',
    };
  }

  private resolveElement(sessionId: string, tabId: string, step: RpaStepDefinition) {
    const element = this.refCache.resolveElement(sessionId, tabId, step);
    if (!element) {
      if (
        step.selector
        || step.target?.kind === 'selector'
        || step.target?.kind === 'text'
        || step.target?.kind === 'upload'
      ) {
        return this.buildAdHocElement(step);
      }
      throw new Error(`Unable to resolve target for step ${step.type}`);
    }
    return element;
  }

  private resolveValue(step: RpaStepDefinition, payload: Record<string, any>) {
    if (step.fieldKey) {
      const authKind = detectAuthCredentialFieldKind({
        key: step.fieldKey,
        label: step.target?.label,
        description: step.description,
      });
      const authValue = authKind
        ? resolveAuthCredentialValue(authKind, payload.auth)
        : undefined;
      return payload.formData?.[step.fieldKey]
        ?? authValue
        ?? payload[step.fieldKey]
        ?? payload.attachments?.find((attachment: any) =>
          attachment.fieldKey === step.fieldKey || attachment.filename === step.value,
        )
        ?? step.value;
    }
    return step.value;
  }

  private resolveUrl(step: RpaStepDefinition, tab: BrowserTabRecord) {
    const candidate = step.target?.kind === 'url'
      ? step.target.value
      : step.value || step.selector || tab.ticket.jumpUrl || tab.flow.platform?.entryUrl || tab.url;
    return this.securityPolicy.sanitizeUrl(candidate);
  }

  private interpolateStep(step: RpaStepDefinition, payload: Record<string, any>): RpaStepDefinition {
    return {
      ...step,
      selector: this.interpolateTemplate(step.selector, payload),
      value: this.interpolateTemplate(step.value, payload),
      script: this.interpolateTemplate(step.script, payload),
      options: this.interpolateValue(step.options, payload),
      target: step.target
        ? {
            ...step.target,
            value: this.interpolateTemplate(step.target.value, payload) || step.target.value,
            label: this.interpolateTemplate(step.target.label, payload) || step.target.label,
          }
        : undefined,
    };
  }

  private interpolateTemplate(value: string | undefined, payload: Record<string, any>) {
    if (!value || !value.includes('{{')) {
      return value;
    }

    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath) => {
      const path = String(rawPath || '').trim();
      const resolved = this.getPayloadValue(payload, path);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }

  private interpolateValue(value: any, payload: Record<string, any>): any {
    if (typeof value === 'string') {
      return this.interpolateTemplate(value, payload);
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.interpolateValue(item, payload));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, current]) => [key, this.interpolateValue(current, payload)]),
    );
  }

  private getPayloadValue(payload: Record<string, any>, path: string) {
    return this.getNestedValue(payload, path) ?? this.getNestedValue(payload.formData || {}, path);
  }

  private getNestedValue(value: Record<string, any>, path: string) {
    return path.split('.').reduce<any>((current, key) => current?.[key], value);
  }

  private buildAdHocElement(step: RpaStepDefinition): BrowserSnapshotElement {
    const runtimeRegionId = this.readRuntimeString(step, 'preferredRegionId');
    const preferredFrameUrl = this.readRuntimeString(step, 'preferredFrameUrl');
    const targetHints = [
      ...(step.target ? [step.target] : []),
      ...(preferredFrameUrl
        ? [{
            kind: 'url',
            value: preferredFrameUrl,
            label: 'scope:frame',
          } as const]
        : []),
    ];

    return {
      ref: `adhoc-${step.fieldKey || step.type}`,
      role: this.resolvePreferredElementRole(step) || this.mapStepRole(step),
      selector: step.target?.kind === 'selector'
        ? step.target.value
        : (step.target?.kind === 'upload' ? step.target.value : step.selector),
      fieldKey: step.fieldKey,
      label: step.target?.label || step.target?.value || step.description,
      text: step.target?.kind === 'text' || step.target?.kind === 'upload'
        ? step.target.value
        : undefined,
      regionId: runtimeRegionId,
      targetHints: targetHints.length > 0 ? targetHints : undefined,
    };
  }

  private mapStepRole(step: RpaStepDefinition): BrowserSnapshotElement['role'] {
    switch (step.type) {
      case 'click':
        return 'button';
      case 'input':
        return 'input';
      case 'select':
        return 'select';
      case 'upload':
        return 'upload';
      case 'extract':
        return step.fieldKey === 'status' ? 'status' : 'text';
      default:
        return 'unknown';
    }
  }

  private resolveEffectiveAction(
    step: RpaStepDefinition,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ): RpaStepDefinition['type'] {
    if (!element) {
      return step.type;
    }

    if (step.type === 'select') {
      if (element.role === 'select') {
        return 'select';
      }

      if (element.role === 'input' || element.role === 'textarea') {
        return 'input';
      }

      if (['checkbox', 'radio', 'button', 'link'].includes(element.role) && this.hasMeaningfulSelectionValue(value)) {
        return 'click';
      }
    }

    if (step.type === 'click' && element.role === 'select' && this.hasMeaningfulSelectionValue(value)) {
      return 'select';
    }

    if (
      step.type === 'input'
      && element.role === 'select'
      && this.hasMeaningfulSelectionValue(value)
    ) {
      return 'select';
    }

    return step.type;
  }

  private hasMeaningfulSelectionValue(value: any) {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'object') {
      return Boolean(value.label || value.value || value.name || value.filename);
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return !['false', '0', 'off', 'no', '否', '未选', 'unchecked', 'none', 'null', 'undefined'].includes(normalized);
  }

  private resolvePreferredElementRole(step: RpaStepDefinition): BrowserSnapshotElement['role'] | undefined {
    const runtimeRole = this.readRuntimeString(step, 'repairedElementRole');
    if (typeof runtimeRole !== 'string') {
      return undefined;
    }

    const allowedRoles = new Set<BrowserSnapshotElement['role']>([
      'button',
      'input',
      'select',
      'checkbox',
      'radio',
      'upload',
      'link',
      'textarea',
      'table',
      'dialog',
      'text',
      'status',
      'unknown',
    ]);
    return allowedRoles.has(runtimeRole as BrowserSnapshotElement['role'])
      ? runtimeRole as BrowserSnapshotElement['role']
      : undefined;
  }

  private readRuntimeString(step: RpaStepDefinition, key: string) {
    const runtime = (step.options as Record<string, any> | undefined)?.__runtime;
    return typeof runtime?.[key] === 'string' ? runtime[key] : undefined;
  }

  private buildEvaluateContext(
    tab: BrowserTabRecord,
    step: RpaStepDefinition,
    value: any,
  ) {
    return {
      payload: tab.payload || {},
      formData: tab.payload?.formData || {},
      auth: tab.payload?.auth || {},
      extractedValues: tab.extractedValues || {},
      ticket: tab.ticket || {},
      tab: {
        url: tab.url,
        title: tab.title,
        history: tab.history,
        action: tab.action,
        pageVersion: tab.pageVersion,
      },
      step: {
        type: step.type,
        selector: step.selector,
        fieldKey: step.fieldKey,
        value,
        description: step.description,
        timeoutMs: step.timeoutMs,
        builtin: step.builtin,
        options: step.options,
        target: step.target,
      },
    };
  }

  private normalizeEvaluateOutput(
    step: RpaStepDefinition,
    value: any,
    currentExtractedValues: Record<string, any> = {},
  ) {
    if (step.fieldKey) {
      return {
        [step.fieldKey]: value,
      };
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return this.mergeEvaluateObjectOutput(currentExtractedValues, value as Record<string, any>);
    }

    if (value === undefined) {
      return undefined;
    }

    return {
      lastEvaluated: value,
    };
  }

  private mergeEvaluateObjectOutput(
    currentExtractedValues: Record<string, any>,
    nextValue: Record<string, any>,
  ) {
    const merged: Record<string, any> = {
      ...(currentExtractedValues || {}),
      ...nextValue,
    };

    for (const [key, value] of Object.entries(nextValue || {})) {
      const currentValue = currentExtractedValues?.[key];
      if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && currentValue
        && typeof currentValue === 'object'
        && !Array.isArray(currentValue)
      ) {
        merged[key] = {
          ...currentValue,
          ...value,
        };
        if (key === 'filledFields') {
          for (const [fieldKey, currentFieldValue] of Object.entries(currentValue)) {
            if (currentFieldValue === true) {
              merged[key][fieldKey] = true;
            }
          }
        }
      }
    }

    return merged;
  }

  private buildStepResult(
    step: RpaStepDefinition,
    index: number,
    snapshotId: string | undefined,
    element: BrowserSnapshotElement | undefined,
    value: any,
    status: RpaExecutedStep['status'],
  ): RpaExecutedStep {
    return {
      index,
      type: step.type,
      selector: step.selector,
      fieldKey: step.fieldKey,
      status,
      value,
      description: step.description,
      elementRef: element?.ref,
      targetKind: step.target?.kind || (step.selector ? 'selector' : undefined),
      snapshotId,
    };
  }

  private requiresElement(type: RpaStepDefinition['type']) {
    return type !== 'goto' && type !== 'wait' && type !== 'screenshot' && type !== 'evaluate';
  }
}
