import type { BrowserSnapshotElement, RpaStepDefinition } from '@uniflow/shared-types';
import type { RpaExecutedStep } from '../adapter-runtime/rpa-executor';
import { BrowserSecurityPolicy } from './browser-security-policy';
import { ElementRefCache } from './element-ref-cache';
import type { BrowserEngineAdapter } from './browser-engine-adapter';
import type { BrowserSessionRecord, BrowserTabRecord } from './browser-runtime.types';
import {
  detectAuthCredentialFieldKind,
  resolveAuthCredentialValue,
} from '../common/auth-field.util';

export class BrowserActionExecutor {
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
    extractedValue?: { key: string; value: any };
    refreshSnapshot: boolean;
  }> {
    const resolvedStep = this.interpolateStep(step, tab.payload);
    this.securityPolicy.assertStepAllowed(resolvedStep);
    const element = this.requiresElement(resolvedStep.type)
      ? this.resolveElement(session.sessionId, tab.tabId, resolvedStep)
      : undefined;
    const value = this.resolveValue(resolvedStep, tab.payload);

    switch (resolvedStep.type) {
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
        break;
      case 'extract': {
        const extracted = await this.engine.extract(session, tab, element);
        const key = resolvedStep.fieldKey || 'lastExtracted';
        tab.extractedValues[key] = extracted;
        return {
          stepResult: this.buildStepResult(resolvedStep, index, snapshotId, element, value, 'executed'),
          extractedValue: { key, value: extracted },
          refreshSnapshot: true,
        };
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
    return {
      stepResult: this.buildStepResult(resolvedStep, index, snapshotId, element, value, 'executed'),
      refreshSnapshot: resolvedStep.type !== 'wait',
    };
  }

  private resolveElement(sessionId: string, tabId: string, step: RpaStepDefinition) {
    const element = this.refCache.resolveElement(sessionId, tabId, step);
    if (!element) {
      if (step.selector || step.target?.kind === 'selector' || step.target?.kind === 'text') {
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

  private getPayloadValue(payload: Record<string, any>, path: string) {
    return this.getNestedValue(payload, path) ?? this.getNestedValue(payload.formData || {}, path);
  }

  private getNestedValue(value: Record<string, any>, path: string) {
    return path.split('.').reduce<any>((current, key) => current?.[key], value);
  }

  private buildAdHocElement(step: RpaStepDefinition): BrowserSnapshotElement {
    return {
      ref: `adhoc-${step.fieldKey || step.type}`,
      role: this.mapStepRole(step),
      selector: step.target?.kind === 'selector' ? step.target.value : step.selector,
      fieldKey: step.fieldKey,
      label: step.description,
      text: step.target?.kind === 'text' ? step.target.value : undefined,
      targetHints: step.target ? [step.target] : undefined,
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
    return type !== 'goto' && type !== 'wait' && type !== 'screenshot';
  }
}
