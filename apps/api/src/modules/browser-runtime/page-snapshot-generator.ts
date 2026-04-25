import { randomUUID } from 'crypto';
import type {
  BrowserPageSnapshot,
  BrowserSnapshotElement,
  BrowserSnapshotElementRole,
  BrowserSnapshotForm,
  BrowserSnapshotFormField,
  BrowserSnapshotRegion,
  RpaActionDefinition,
  RpaFieldBinding,
  RpaStepDefinition,
} from '@uniflow/shared-types';
import { BrowserSecurityPolicy } from './browser-security-policy';
import { ElementRefCache } from './element-ref-cache';
import type { BrowserPageCapture, BrowserSessionRecord, BrowserTabRecord } from './browser-runtime.types';

export class PageSnapshotGenerator {
  constructor(
    private readonly refCache: ElementRefCache,
    private readonly securityPolicy: BrowserSecurityPolicy,
  ) {}

  generate(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    pageCapture?: BrowserPageCapture,
  ): BrowserPageSnapshot {
    const snapshotId = `snapshot-${randomUUID().slice(0, 8)}`;
    const mainRegionId = 'main';
    const statusRegionId = 'status';
    const elements = pageCapture
      ? pageCapture.interactiveElements.map((element) => ({
          ...element,
          ref: '',
          regionId: element.regionId || this.inferCapturedElementRegionId(pageCapture, element.selector),
        }))
      : this.buildInteractiveElements(tab, mainRegionId, statusRegionId);
    const cachedElements = this.refCache.cacheElements(session.sessionId, tab.tabId, elements);
    const forms = pageCapture
      ? this.buildCapturedForms(pageCapture, cachedElements, tab)
      : this.buildForms(tab, cachedElements);
    const regions = pageCapture
      ? this.buildCapturedRegions(pageCapture, cachedElements, tab, mainRegionId, statusRegionId)
      : this.buildRegions(cachedElements, tab, mainRegionId, statusRegionId);
    const importantTexts = pageCapture?.importantTexts?.length
      ? pageCapture.importantTexts
      : this.buildImportantTexts(tab);

    const snapshot: BrowserPageSnapshot = {
      snapshotId,
      title: pageCapture?.title || tab.title || tab.flow.processName,
      url: pageCapture?.url || tab.url,
      generatedAt: new Date().toISOString(),
      regions,
      forms,
      tables: pageCapture?.tables || (tab.action === 'queryStatus'
        ? [{
            id: 'table-status',
            name: '状态信息',
            summary: `当前单号 ${tab.payload.submissionId || '未提供'} 的状态查询区域`,
          }]
        : []),
      dialogs: pageCapture?.dialogs || [],
      importantTexts,
      interactiveElements: cachedElements,
      structuredText: '',
    };

    snapshot.structuredText = this.buildStructuredText(snapshot);
    const sanitized = this.securityPolicy.sanitizeSnapshot(snapshot);
    tab.lastSnapshotId = sanitized.snapshotId;
    return sanitized;
  }

  private buildInteractiveElements(tab: BrowserTabRecord, mainRegionId: string, statusRegionId: string) {
    const merged = new Map<string, BrowserSnapshotElement>();
    const actionDefinition = this.getActionDefinition(tab);

    for (const field of tab.flow.fields || []) {
      const step = actionDefinition?.steps.find((candidate) => candidate.fieldKey === field.key);
      this.registerElement(
        merged,
        this.buildFieldElement(field, step, mainRegionId, tab),
      );
    }

    for (const step of actionDefinition?.steps || []) {
      const candidate = this.buildStepElement(step, tab, mainRegionId, statusRegionId);
      if (candidate) {
        this.registerElement(merged, candidate);
      }
    }

    if (tab.action === 'submit') {
      this.registerElement(merged, {
        ref: '',
        role: 'button',
        text: '提交',
        label: '提交',
        selector: '#submit',
        regionId: mainRegionId,
      });
    } else {
      this.registerElement(merged, {
        ref: '',
        role: 'status',
        text: this.deriveStatus(tab.payload.submissionId),
        label: '审批状态',
        fieldKey: 'status',
        selector: '#status',
        regionId: statusRegionId,
      });
    }

    return [...merged.values()];
  }

  private buildFieldElement(
    field: RpaFieldBinding,
    step: RpaStepDefinition | undefined,
    regionId: string,
    tab: BrowserTabRecord,
  ): BrowserSnapshotElement {
    return {
      ref: '',
      role: this.mapFieldRole(field.type),
      label: field.label || field.key,
      fieldKey: field.key,
      selector: step?.selector || field.selector,
      regionId,
      required: field.required,
      value: this.stringifyValue(tab.formValues[field.key] ?? tab.payload.formData?.[field.key] ?? field.defaultValue),
      targetHints: step?.target ? [step.target] : undefined,
    };
  }

  private buildStepElement(
    step: RpaStepDefinition,
    tab: BrowserTabRecord,
    mainRegionId: string,
    statusRegionId: string,
  ): BrowserSnapshotElement | undefined {
    if (step.type === 'goto' || step.type === 'wait' || step.type === 'screenshot') {
      return undefined;
    }

    if (step.type === 'extract') {
      return {
        ref: '',
        role: tab.action === 'queryStatus' ? 'status' : 'text',
        text: tab.action === 'queryStatus' ? this.deriveStatus(tab.payload.submissionId) : step.description,
        label: step.description || step.fieldKey || '提取区域',
        fieldKey: step.fieldKey,
        selector: step.selector,
        regionId: tab.action === 'queryStatus' ? statusRegionId : mainRegionId,
        targetHints: step.target ? [step.target] : undefined,
      };
    }

    return {
      ref: '',
      role: this.mapStepRole(step),
      text: step.type === 'click' ? (step.description || '按钮') : undefined,
      label: step.description || step.fieldKey || step.selector || step.type,
      fieldKey: step.fieldKey,
      selector: step.selector,
      regionId: mainRegionId,
      value: this.stringifyValue(step.value),
      targetHints: step.target ? [step.target] : undefined,
    };
  }

  private buildForms(tab: BrowserTabRecord, elements: BrowserSnapshotElement[]): BrowserSnapshotForm[] {
    if (!tab.flow.fields || tab.flow.fields.length === 0) {
      return [];
    }

    const fields: BrowserSnapshotFormField[] = elements
      .filter((element) => !!element.fieldKey)
      .map((element) => ({
        ref: element.ref,
        label: element.label,
        fieldKey: element.fieldKey,
        required: element.required,
      }));

    return [{
      id: 'form-main',
      name: tab.action === 'submit' ? `${tab.flow.processName}表单` : `${tab.flow.processName}查询表单`,
      fieldRefs: fields.map((field) => field.ref),
      fields,
    }];
  }

  private buildCapturedForms(
    pageCapture: BrowserPageCapture,
    elements: BrowserSnapshotElement[],
    tab: BrowserTabRecord,
  ): BrowserSnapshotForm[] {
    if (!pageCapture.forms || pageCapture.forms.length === 0) {
      return this.buildForms(tab, elements);
    }

    return pageCapture.forms.map((form) => {
      const fields: BrowserSnapshotFormField[] = form.fields.map((field) => {
        const matched = elements.find((element) =>
          (field.selector && element.selector === field.selector)
          || (field.fieldKey && element.fieldKey === field.fieldKey)
          || (field.label && element.label === field.label)
        );
        return {
          ref: matched?.ref || '',
          label: field.label || matched?.label,
          fieldKey: field.fieldKey || matched?.fieldKey,
          required: field.required ?? matched?.required,
        };
      });

      return {
        id: form.id,
        name: form.name,
        fieldRefs: fields.map((field) => field.ref).filter(Boolean),
        fields,
      };
    });
  }

  private buildRegions(
    elements: BrowserSnapshotElement[],
    tab: BrowserTabRecord,
    mainRegionId: string,
    statusRegionId: string,
  ): BrowserSnapshotRegion[] {
    const mainRegion: BrowserSnapshotRegion = {
      id: mainRegionId,
      role: 'main',
      name: tab.action === 'submit' ? '主操作区' : '查询操作区',
      summary: tab.action === 'submit' ? '用于填写并提交业务表单' : '用于查询并读取流程状态',
      elementRefs: elements.filter((element) => element.regionId === mainRegionId).map((element) => element.ref),
    };

    const statusRegion: BrowserSnapshotRegion = {
      id: statusRegionId,
      role: 'status',
      name: '状态区',
      summary: '展示流程状态和关键提示信息',
      elementRefs: elements.filter((element) => element.regionId === statusRegionId).map((element) => element.ref),
    };

    return statusRegion.elementRefs.length > 0
      ? [mainRegion, statusRegion]
      : [mainRegion];
  }

  private buildCapturedRegions(
    pageCapture: BrowserPageCapture,
    elements: BrowserSnapshotElement[],
    tab: BrowserTabRecord,
    mainRegionId: string,
    statusRegionId: string,
  ): BrowserSnapshotRegion[] {
    if (!pageCapture.regions || pageCapture.regions.length === 0) {
      return this.buildRegions(elements, tab, mainRegionId, statusRegionId);
    }

    return pageCapture.regions.map((region) => ({
      id: region.id,
      role: region.role,
      name: region.name,
      summary: region.summary,
      elementRefs: elements
        .filter((element) =>
          (region.elementSelectors || []).includes(element.selector || '')
          || element.regionId === region.id,
        )
        .map((element) => element.ref),
    }));
  }

  private inferCapturedElementRegionId(
    pageCapture: BrowserPageCapture,
    selector?: string,
  ) {
    const normalizedSelector = String(selector || '').trim();
    if (!normalizedSelector || !Array.isArray(pageCapture.regions)) {
      return undefined;
    }

    return pageCapture.regions.find((region) =>
      Array.isArray(region.elementSelectors)
      && region.elementSelectors.includes(normalizedSelector),
    )?.id;
  }

  private buildImportantTexts(tab: BrowserTabRecord) {
    const texts = [
      `${tab.flow.processName}`,
      tab.action === 'submit' ? '当前任务为提交流程' : `当前查询单号 ${tab.payload.submissionId || '未提供'}`,
      tab.ticket.jumpUrl ? `跳转地址 ${tab.ticket.jumpUrl}` : undefined,
    ];

    if (tab.action === 'queryStatus') {
      texts.push(`当前状态 ${this.deriveStatus(tab.payload.submissionId)}`);
    }

    return texts.filter((item): item is string => !!item);
  }

  private buildStructuredText(snapshot: BrowserPageSnapshot) {
    const lines: string[] = [
      `标题: ${snapshot.title}`,
      `URL: ${snapshot.url}`,
      '主要区域:',
      ...snapshot.regions.map((region) => `- ${region.id} | ${region.role} | ${region.name} | ${region.summary || ''}`),
    ];

    if (snapshot.forms.length > 0) {
      lines.push('表单:');
      for (const form of snapshot.forms) {
        lines.push(`- ${form.id} | ${form.name}`);
        for (const field of form.fields) {
          lines.push(`  - ${field.ref} | ${field.label || field.fieldKey || '字段'} | ${field.required ? '必填' : '选填'}`);
        }
      }
    }

    if (snapshot.tables.length > 0) {
      lines.push('表格:');
      lines.push(...snapshot.tables.map((table) => `- ${table.id} | ${table.name} | ${table.summary || ''}`));
    }

    if (snapshot.importantTexts.length > 0) {
      lines.push('重要文本:');
      lines.push(...snapshot.importantTexts.map((text) => `- ${text}`));
    }

    lines.push('可交互元素:');
    lines.push(...snapshot.interactiveElements.map((element) => [
      `- ${element.ref}`,
      element.role,
      element.label ? `标签=${element.label}` : undefined,
      element.text ? `文本=${element.text}` : undefined,
      element.fieldKey ? `字段=${element.fieldKey}` : undefined,
      element.selector ? `选择器=${element.selector}` : undefined,
      element.regionId ? `区域=${element.regionId}` : undefined,
    ].filter(Boolean).join(' | ')));

    return lines.join('\n');
  }

  private registerElement(store: Map<string, BrowserSnapshotElement>, element: BrowserSnapshotElement) {
    const key = [
      element.role,
      element.selector || '',
      element.fieldKey || '',
      element.label || '',
      element.text || '',
    ].join('|');
    if (!store.has(key)) {
      store.set(key, element);
    }
  }

  private getActionDefinition(tab: BrowserTabRecord): RpaActionDefinition | undefined {
    return tab.action === 'submit'
      ? tab.flow.actions?.submit
      : tab.flow.actions?.queryStatus;
  }

  private mapFieldRole(fieldType?: string): BrowserSnapshotElementRole {
    switch (fieldType) {
      case 'select':
      case 'radio':
        return 'select';
      case 'checkbox':
        return 'checkbox';
      case 'file':
        return 'upload';
      case 'textarea':
        return 'textarea';
      default:
        return 'input';
    }
  }

  private mapStepRole(step: RpaStepDefinition): BrowserSnapshotElementRole {
    switch (step.type) {
      case 'click':
        return 'button';
      case 'select':
        return 'select';
      case 'upload':
        return 'upload';
      case 'download':
        return 'link';
      case 'input':
        return 'input';
      default:
        return 'unknown';
    }
  }

  private deriveStatus(submissionId: string | undefined) {
    return 'submitted';
  }

  private stringifyValue(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }
}
