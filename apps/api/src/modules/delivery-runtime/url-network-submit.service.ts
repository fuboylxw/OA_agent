import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { Injectable, Optional } from '@nestjs/common';
import { sanitizeStructuredData } from '@uniflow/agent-kernel';
import { ChoiceRequestPatchInferenceEngine } from '@uniflow/compat-engine';
import type {
  RpaFieldBinding,
  RpaFieldRequestPatch,
  RpaNetworkMappingRule,
  RpaNetworkRequestDefinition,
} from '@uniflow/shared-types';
import type { StatusResult, SubmitResult } from '@uniflow/oa-adapters';
import { BrowserTaskRuntime } from '../browser-runtime/browser-task-runtime';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';

interface UrlNetworkBaseInput {
  connectorId: string;
  processCode: string;
  processName: string;
  context: UrlDeliveryExecutionContext;
}

interface UrlNetworkSubmitInput extends UrlNetworkBaseInput {
  action: 'submit';
  payload: Record<string, any>;
}

interface UrlNetworkStatusInput extends UrlNetworkBaseInput {
  action: 'queryStatus';
  payload: Record<string, any>;
}

type UrlNetworkExecutionInput = UrlNetworkSubmitInput | UrlNetworkStatusInput;

interface UrlNetworkAttachmentPayload {
  filename?: string;
  name?: string;
  content?: string | Buffer;
  mimeType?: string;
  fieldKey?: string | null;
}

interface InferredFieldPatchCandidate {
  path: string;
  value: any;
}

interface PreflightResult {
  extractedValues: Record<string, any>;
  session?: {
    sessionId: string;
    provider: string;
    requestedProvider: string;
  };
  snapshots?: Array<{ snapshotId: string; title?: string; url?: string }>;
}

@Injectable()
export class UrlNetworkSubmitService {
  private readonly client: AxiosInstance;
  private readonly browserTaskRuntime: BrowserTaskRuntime;
  private readonly choiceRequestPatchInference = new ChoiceRequestPatchInferenceEngine();

  constructor(
    @Optional()
    browserTaskRuntime?: BrowserTaskRuntime,
    @Optional()
    client?: AxiosInstance,
  ) {
    this.browserTaskRuntime = browserTaskRuntime || new BrowserTaskRuntime();
    this.client = client || axios.create({
      timeout: 30000,
      validateStatus: () => true,
    });
  }

  async execute(input: UrlNetworkExecutionInput): Promise<{
    submitResult?: SubmitResult;
    statusResult?: StatusResult;
    artifactRefs: Array<{ id: string; kind: 'page_snapshot'; summary: string }>;
    summary: string;
  }> {
    const requestDef = input.action === 'submit'
      ? input.context.runtime.networkSubmit
      : input.context.runtime.networkStatus;
    if (!requestDef?.url) {
      throw new Error(`No URL network ${input.action} definition is configured for ${input.processCode}`);
    }

    const preflight = await this.runPreflight(input);
    const requestContext = this.buildRequestContext(input, preflight.extractedValues);
    const request = await this.buildHttpRequest(requestDef, requestContext, input.context);
    const response = await this.client.request(request);
    const responseBody = response.data;
    const responseMetadata = this.mapResponse(requestDef, responseBody);
    const success = this.resolveSuccess(input.action, requestDef, response.status, responseMetadata);
    const summary = this.resolveSummary(input, success, responseMetadata.message);
    const artifactRefs = this.toArtifactRefs(preflight.snapshots);
    const metadata = sanitizeStructuredData({
      mode: 'url-network',
      action: input.action,
      completionKind: requestDef?.completionKind || 'submitted',
      connectorId: input.connectorId,
      flowCode: input.processCode,
      jumpUrl: input.context.ticket.jumpUrl,
      request: {
        method: request.method,
        url: request.url,
        completionKind: requestDef?.completionKind || 'submitted',
        query: request.params,
        headers: this.maskHeaders(request.headers),
        body: this.maskBody(request.data),
      },
      response: {
        status: response.status,
        data: responseBody,
      },
      preflight: {
        extractedValues: preflight.extractedValues,
        session: preflight.session,
      },
      deliveryPath: 'url',
    });

    if (input.action === 'submit') {
      return {
        submitResult: {
          success,
          submissionId: responseMetadata.submissionId,
          errorMessage: success ? undefined : (responseMetadata.message || `URL network submit failed with HTTP ${response.status}`),
          metadata,
        } satisfies SubmitResult,
        artifactRefs,
        summary,
      };
    }

    return {
      statusResult: {
        status: success
          ? (responseMetadata.status || 'submitted')
          : 'error',
        statusDetail: success
          ? metadata
          : {
              ...metadata,
              error: responseMetadata.message || `URL network status failed with HTTP ${response.status}`,
            },
        timeline: [],
      } satisfies StatusResult,
      artifactRefs,
      summary,
    };
  }

  private async runPreflight(input: UrlNetworkExecutionInput): Promise<PreflightResult> {
    const action = input.context.runtime.preflight;
    if (!action?.steps?.length) {
      return {
        extractedValues: {},
      };
    }

    const result = await this.browserTaskRuntime.run({
      action: input.action,
      flow: {
        processCode: input.processCode,
        processName: input.processName,
        actions: {
          [input.action]: action,
        },
        platform: input.context.rpaFlow?.rpaDefinition.platform,
        runtime: input.context.rpaFlow?.rpaDefinition.runtime,
      } as any,
      runtime: {
        ...input.context.runtime,
        executorMode: 'browser',
      },
      payload: {
        ...input.payload,
        auth: input.context.authConfig,
      },
      ticket: input.context.ticket,
    });

    if (!result.success) {
      throw new Error(result.errorMessage || 'URL preflight failed');
    }

    return {
      extractedValues: result.extractedValues || {},
      session: {
        sessionId: result.sessionId,
        provider: result.provider,
        requestedProvider: result.requestedProvider,
      },
      snapshots: result.snapshots,
    };
  }

  private buildRequestContext(
    input: UrlNetworkExecutionInput,
    preflightValues: Record<string, any>,
  ) {
    const auth = input.context.authConfig || {};
    const platformConfig = this.asRecord(auth.platformConfig);
    return {
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName,
      jumpUrl: input.context.ticket.jumpUrl,
      ticket: input.context.ticket.ticket,
      ticketHeaders: input.context.ticket.headers || {},
      auth,
      authPlatform: platformConfig,
      formData: input.payload.formData || {},
      attachments: Array.isArray(input.payload.attachments) ? input.payload.attachments : [],
      payload: input.payload,
      preflight: preflightValues,
      page: preflightValues,
      submissionId: input.payload.submissionId,
    };
  }

  private async buildHttpRequest(
    definition: RpaNetworkRequestDefinition,
    context: Record<string, any>,
    deliveryContext: UrlDeliveryExecutionContext,
  ): Promise<AxiosRequestConfig> {
    const method = String(this.interpolateTemplate(String(definition.method || 'POST'), context) || 'POST').toUpperCase();
    const url = this.interpolateTemplate(definition.url, context);
    const params = await this.applyFieldRequestPatches(
      'query',
      this.applyMapping(definition.query, context),
      context,
      deliveryContext,
    );
    const bodyMode = this.resolveBodyMode(definition.bodyMode, context);
    const capturedHeaders = this.normalizeStringMap(
      this.asRecord(context.preflight?.submitRequestHeaders),
      context,
    );
    const headers = await this.applyFieldRequestPatches(
      'headers',
      {
        ...capturedHeaders,
        ...this.normalizeStringMap(deliveryContext.runtime.headers || {}, context),
        ...this.normalizeStringMap(definition.headers || {}, context),
        ...(deliveryContext.ticket.headers || {}),
        ...this.buildSessionHeaders(context.auth, context.authPlatform, url),
      },
      context,
      deliveryContext,
    );
    const config: AxiosRequestConfig = {
      method: method as any,
      url,
      params,
      headers,
      timeout: deliveryContext.runtime.timeoutMs || 30000,
      validateStatus: () => true,
    };

    delete (config.headers as Record<string, any>).host;
    delete (config.headers as Record<string, any>)['content-length'];

    if (!['GET', 'DELETE'].includes(method)) {
      const builtBody = await this.applyFieldRequestPatches(
        'body',
        this.buildRequestBody(context, definition.body),
        context,
        deliveryContext,
      );
      await this.validateRequiredFieldBindings({
        body: builtBody,
        query: params,
        headers,
        context,
        deliveryContext,
      });

      if (bodyMode === 'multipart') {
        const multipart = this.buildMultipartRequestBody(context, builtBody, deliveryContext);
        config.data = multipart;
        delete (config.headers as Record<string, string>)['Content-Type'];
      } else if (bodyMode === 'form') {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(this.flattenUndefined(builtBody))) {
          searchParams.set(key, value === undefined || value === null ? '' : String(value));
        }
        config.data = searchParams.toString();
        (config.headers as Record<string, string>)['Content-Type'] =
          (config.headers as Record<string, string>)['Content-Type'] || 'application/x-www-form-urlencoded';
      } else {
        config.data = builtBody;
        (config.headers as Record<string, string>)['Content-Type'] =
          (config.headers as Record<string, string>)['Content-Type'] || 'application/json';
      }
    }

    return config;
  }

  private buildRequestBody(context: Record<string, any>, template: any): any {
    if (template === undefined) {
      return context.formData || {};
    }

    if (typeof template === 'string') {
      return this.interpolateTemplate(template, context);
    }

    if (!template || typeof template !== 'object') {
      return template;
    }

    if (this.isMappingRule(template)) {
      return this.resolveRule(template as RpaNetworkMappingRule, context);
    }

    if (Array.isArray(template)) {
      return template.map((item) => this.buildRequestBody(context, item));
    }

    const mergeSources = this.resolveMergeSources(template, context);
    if (mergeSources) {
      return mergeSources;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string') {
        result[key] = this.interpolateTemplate(value, context);
      } else if (this.isMappingRule(value)) {
        result[key] = this.resolveRule(value as RpaNetworkMappingRule, context);
      } else if (value && typeof value === 'object') {
        result[key] = this.buildRequestBody(context, value);
      } else {
        result[key] = value;
      }
    }
    return this.flattenUndefined(result);
  }

  private buildMultipartRequestBody(
    context: Record<string, any>,
    body: any,
    deliveryContext: UrlDeliveryExecutionContext,
  ) {
    const FormDataCtor = (globalThis as any).FormData;
    const BlobCtor = (globalThis as any).Blob;
    if (typeof FormDataCtor !== 'function' || typeof BlobCtor !== 'function') {
      throw new Error('Runtime multipart form support is unavailable');
    }

    const form = new FormDataCtor();
    const requestFieldNamesWithFiles = new Set<string>();
    const attachmentFieldMap = this.asRecord(context.preflight?.attachmentFieldMap);
    const fieldBindings = this.getFieldBindings(deliveryContext, context.preflight);
    const attachments = Array.isArray(context.attachments)
      ? context.attachments.map((attachment) => this.normalizeAttachmentPayload(attachment))
      : [];

    for (const attachment of attachments) {
      if (!attachment) {
        continue;
      }
      const targetFieldKey = this.normalizeString(attachment.fieldKey);
      const explicitRequestFieldName = targetFieldKey
        ? this.normalizeString(fieldBindings.get(targetFieldKey)?.requestFieldName)
        : undefined;
      const requestFieldName = this.normalizeString(
        (targetFieldKey && attachmentFieldMap[targetFieldKey])
        || explicitRequestFieldName
        || targetFieldKey,
      );
      if (!requestFieldName) {
        continue;
      }

      form.append(
        requestFieldName,
        new BlobCtor([attachment.buffer], {
          type: attachment.mimeType || 'application/octet-stream',
        }),
        attachment.filename,
      );
      requestFieldNamesWithFiles.add(requestFieldName);
    }

    this.appendMultipartFields(form, body, requestFieldNamesWithFiles);
    return form;
  }

  private appendMultipartFields(
    form: any,
    value: any,
    requestFieldNamesWithFiles: Set<string>,
    prefix?: string,
  ) {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const nextPrefix = prefix ? `${prefix}[${index}]` : String(index);
        this.appendMultipartFields(form, item, requestFieldNamesWithFiles, nextPrefix);
      });
      return;
    }

    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        this.appendMultipartFields(form, item, requestFieldNamesWithFiles, nextPrefix);
      }
      return;
    }

    if (!prefix || requestFieldNamesWithFiles.has(prefix)) {
      return;
    }

    form.append(prefix, String(value));
  }

  private async applyFieldRequestPatches(
    scope: 'body' | 'query' | 'headers',
    target: any,
    context: Record<string, any>,
    deliveryContext: UrlDeliveryExecutionContext,
  ) {
    const fields = this.getFieldBindings(deliveryContext, context.preflight);
    if (fields.size === 0) {
      return target;
    }

    let patchedTarget = target;
    for (const field of fields.values()) {
      const patches = Array.isArray(field.requestPatches)
        ? field.requestPatches as RpaFieldRequestPatch[]
        : [];
      if (patches.length === 0) {
        continue;
      }

      for (const patch of patches) {
        if (!patch || typeof patch !== 'object') {
          continue;
        }
        const normalizedScope = String(patch.scope || 'body').trim().toLowerCase();
        if (normalizedScope !== scope) {
          continue;
        }

        const value = this.resolveFieldPatchValue(field, patch, context);
        if (value === undefined) {
          continue;
        }

        patchedTarget = this.setValueAtRequestPath(
          patchedTarget,
          String(patch.path || '').trim(),
          value,
        );
      }
    }

    return await this.applyInferredFieldRequestPatches(
      scope,
      patchedTarget,
      context,
      deliveryContext,
    );
  }

  private async applyInferredFieldRequestPatches(
    scope: 'body' | 'query' | 'headers',
    target: any,
    context: Record<string, any>,
    deliveryContext: UrlDeliveryExecutionContext,
  ) {
    if (scope !== 'body') {
      return target;
    }

    let patchedTarget = target;
    for (const field of this.getFieldBindings(deliveryContext, context.preflight).values()) {
      if (this.hasExplicitRequestPatch(field) || !this.supportsInferredBodyPatch(field)) {
        continue;
      }

      const submittedValue = context.formData?.[field.key];
      if (this.isEmptyRuntimeValue(submittedValue)) {
        continue;
      }

      const candidates = await this.buildInferredBodyPatchCandidates(
        field,
        submittedValue,
        patchedTarget,
        deliveryContext,
        context.preflight,
      );
      for (const candidate of candidates) {
        if (!candidate.path) {
          continue;
        }
        const actual = this.getValueAtRequestPath(patchedTarget, candidate.path);
        if (this.valuesRoughlyEqual(actual, candidate.value)) {
          continue;
        }
        patchedTarget = this.setValueAtRequestPath(
          patchedTarget,
          candidate.path,
          candidate.value,
        );
      }
    }

    return patchedTarget;
  }

  private async validateRequiredFieldBindings(input: {
    body: any;
    query: any;
    headers: Record<string, any>;
    context: Record<string, any>;
    deliveryContext: UrlDeliveryExecutionContext;
  }) {
    const fields = [...this.getFieldBindings(input.deliveryContext, input.context.preflight).values()];
    if (fields.length === 0) {
      return;
    }

    const filledFields = this.asRecord(input.context.preflight?.filledFields);
    const attachmentFieldMap = this.asRecord(input.context.preflight?.attachmentFieldMap);
    const attachments = Array.isArray(input.context.attachments) ? input.context.attachments : [];
    const missingLabels: string[] = [];

    for (const field of fields) {
      if (!field.required) {
        continue;
      }

      const fieldKey = this.normalizeString(field.key);
      const fieldLabel = this.normalizeString(field.label) || fieldKey || '未命名字段';
      if (!fieldKey) {
        continue;
      }

      if (String(field.type || '').trim().toLowerCase() === 'file') {
        const fieldAttachments = attachments.filter((attachment) => this.normalizeString(attachment?.fieldKey) === fieldKey);
        if (fieldAttachments.length === 0) {
          continue;
        }
        if (this.hasSuccessfulDomBinding(field, filledFields)) {
          continue;
        }
        const requestFieldName = this.normalizeString(
          attachmentFieldMap[fieldKey]
          || field.requestFieldName,
        );
        const hasFilePatch = Array.isArray(field.requestPatches) && field.requestPatches.length > 0;
        const hasFileNameInRequest = fieldAttachments.some((attachment) =>
          this.requestContainsValue(input.body, attachment?.filename || attachment?.name)
          || this.requestContainsValue(input.query, attachment?.filename || attachment?.name)
          || this.requestContainsValue(input.headers, attachment?.filename || attachment?.name));
        if (!requestFieldName && !hasFilePatch && !hasFileNameInRequest) {
          missingLabels.push(fieldLabel);
        }
        continue;
      }

      const submittedValue = input.context.formData?.[fieldKey];
      if (this.isEmptyRuntimeValue(submittedValue)) {
        continue;
      }

      const hasDomBinding = this.hasSuccessfulDomBinding(field, filledFields);
      if (!this.isChoiceField(field) && hasDomBinding) {
        continue;
      }

      if (await this.hasPatchedRequestValue(
        field,
        submittedValue,
        input.body,
        input.query,
        input.headers,
        input.deliveryContext,
        input.context.preflight,
      )) {
        continue;
      }

      if (
        this.isChoiceField(field)
        && hasDomBinding
        && this.canAcceptChoiceDomBindingWithoutExplicitRequestValue(
          field,
          input.body,
          input.deliveryContext,
          input.context.preflight,
        )
      ) {
        continue;
      }

      if (
        this.requestContainsValue(input.body, submittedValue)
        || this.requestContainsValue(input.query, submittedValue)
        || this.requestContainsValue(input.headers, submittedValue)
      ) {
        continue;
      }

      missingLabels.push(fieldLabel);
    }

    if (missingLabels.length > 0) {
      throw new Error(`URL runtime failed to bind required fields: ${missingLabels.join('、')}`);
    }
  }

  private hasSuccessfulDomBinding(
    field: Pick<RpaFieldBinding, 'key' | 'label' | 'selector' | 'id' | 'name' | 'placeholder'>,
    filledFields: Record<string, any>,
  ) {
    const candidateKeys = [
      field.key,
      field.label,
      field.selector,
      field.id,
      field.name,
      field.placeholder,
    ]
      .map((item) => this.normalizeString(item))
      .filter((item): item is string => Boolean(item));

    return candidateKeys.some((key) => filledFields[key] === true);
  }

  private async hasPatchedRequestValue(
    field: RpaFieldBinding,
    submittedValue: any,
    body: any,
    query: any,
    headers: Record<string, any>,
    deliveryContext?: UrlDeliveryExecutionContext,
    preflightValues?: Record<string, any>,
  ) {
    const patches = Array.isArray(field.requestPatches)
      ? field.requestPatches as RpaFieldRequestPatch[]
      : [];
    const hasExplicitPatchMatch = patches.some((patch) => {
      const path = String(patch?.path || '').trim();
      if (!path) {
        return false;
      }
      const scope = String(patch?.scope || 'body').trim().toLowerCase();
      const target = scope === 'query'
        ? query
        : scope === 'headers'
          ? headers
          : body;
      const actual = this.getValueAtRequestPath(target, path);
      return this.valuesRoughlyEqual(actual, this.applyPatchTransform(submittedValue, patch?.transform));
    });
    if (hasExplicitPatchMatch) {
      return true;
    }

    if (!deliveryContext) {
      return false;
    }

    return (await this.buildInferredBodyPatchCandidates(field, submittedValue, body, deliveryContext, preflightValues))
      .some((candidate) =>
        this.valuesRoughlyEqual(
          this.getValueAtRequestPath(body, candidate.path),
          candidate.value,
        ));
  }

  private hasExplicitRequestPatch(field: RpaFieldBinding) {
    return Array.isArray(field.requestPatches)
      && field.requestPatches.some((patch) => patch && typeof patch === 'object' && !Array.isArray(patch));
  }

  private supportsInferredBodyPatch(field: RpaFieldBinding) {
    const normalizedType = this.normalizeString(field.type)?.toLowerCase() || '';
    return normalizedType !== 'file';
  }

  private canAcceptChoiceDomBindingWithoutExplicitRequestValue(
    field: RpaFieldBinding,
    body: any,
    deliveryContext: UrlDeliveryExecutionContext,
    preflightValues?: Record<string, any>,
  ) {
    if (this.hasExplicitRequestPatch(field)) {
      return false;
    }

    const relatedMappings = this.getCaptureFormFieldMappings(deliveryContext, field.key, preflightValues);
    if (relatedMappings.length === 0) {
      return false;
    }

    const relatedTokens = Array.from(new Set(relatedMappings.flatMap((mapping) =>
      this.extractStructuredFieldTokens({
        id: this.normalizeString(mapping?.target?.id),
        selector: this.normalizeString(mapping?.target?.selector),
        requestFieldName: this.normalizeString(mapping?.target?.requestFieldName || mapping?.target?.name),
      }),
    )));
    if (relatedTokens.length === 0) {
      return true;
    }

    const candidatePaths = this.buildStructuredFieldCandidatePaths(body, relatedTokens);
    return candidatePaths.length === 0;
  }

  private isChoiceField(field: Pick<RpaFieldBinding, 'type' | 'multiple'>) {
    const normalizedType = this.normalizeString(field.type)?.toLowerCase() || '';
    return normalizedType === 'checkbox'
      || normalizedType === 'radio'
      || (normalizedType === 'select' && field.multiple === true);
  }

  private async buildInferredBodyPatchCandidates(
    field: RpaFieldBinding,
    submittedValue: any,
    body: any,
    deliveryContext: UrlDeliveryExecutionContext,
    preflightValues?: Record<string, any>,
  ): Promise<InferredFieldPatchCandidate[]> {
    if (this.isChoiceField(field)) {
      return await this.buildChoiceBodyPatchCandidates(field, submittedValue, body, deliveryContext, preflightValues);
    }

    return this.inferBodyPatchPaths(field, body).map((path) => ({
      path,
      value: submittedValue,
    }));
  }

  private async buildChoiceBodyPatchCandidates(
    field: RpaFieldBinding,
    submittedValue: any,
    body: any,
    deliveryContext: UrlDeliveryExecutionContext,
    preflightValues?: Record<string, any>,
  ): Promise<InferredFieldPatchCandidate[]> {
    if (this.isEmptyRuntimeValue(submittedValue)) {
      return [];
    }

    const relatedMappings = this.getCaptureFormFieldMappings(deliveryContext, field.key, preflightValues);
    const relatedTokens = Array.from(new Set(relatedMappings.flatMap((mapping) =>
      this.extractStructuredFieldTokens({
        id: this.normalizeString(mapping?.target?.id),
        selector: this.normalizeString(mapping?.target?.selector),
        requestFieldName: this.normalizeString(mapping?.target?.requestFieldName || mapping?.target?.name),
      }),
    )));
    const structuredRoots = this.findStructuredFieldContainerRoots(body, relatedTokens);
    const candidates: InferredFieldPatchCandidate[] = [];
    const seenPaths = new Set<string>();

    for (const mapping of relatedMappings) {
      const mappingAliases = this.collectChoiceAliases(mapping, field);
      const knownOptionAliases = Array.from(new Set(
        relatedMappings.flatMap((candidate) => this.collectChoiceAliases(candidate, field)),
      ));
      const fieldTokens = this.extractStructuredFieldTokens({
        id: this.normalizeString(mapping?.target?.id),
        selector: this.normalizeString(mapping?.target?.selector),
        requestFieldName: this.normalizeString(mapping?.target?.requestFieldName || mapping?.target?.name),
      });
      if (fieldTokens.length === 0) {
        continue;
      }

      const candidatePaths = this.buildStructuredFieldCandidatePaths(body, fieldTokens, structuredRoots);

      for (const path of candidatePaths) {
        if (!path || seenPaths.has(path)) {
          continue;
        }
        const actual = this.getValueAtRequestPath(body, path);
        const judgement = await this.choiceRequestPatchInference.infer({
          submittedValue,
          currentValue: actual,
          field: {
            key: field.key,
            label: field.label,
            type: field.type,
            multiple: field.multiple,
          },
          mapping: {
            label: this.normalizeString(mapping?.target?.label),
            optionAliases: mappingAliases,
            requestFieldName: this.normalizeString(mapping?.target?.requestFieldName || mapping?.target?.name),
            selector: this.normalizeString(mapping?.target?.selector),
            targetId: this.normalizeString(mapping?.target?.id),
          },
          knownOptionAliases,
          candidatePath: path,
          siblingOptionCount: relatedMappings.length,
          trace: {
            scope: 'delivery.url.choice_request_patch',
            metadata: {
              processCode: deliveryContext.rpaFlow?.processCode,
              fieldKey: field.key,
              candidatePath: path,
            },
          },
        });
        if (!judgement.canResolve) {
          continue;
        }
        candidates.push({
          path,
          value: judgement.patchValue,
        });
        seenPaths.add(path);
      }
    }

    return candidates;
  }

  private inferBodyPatchPaths(field: RpaFieldBinding, body: any) {
    const paths = new Set<string>();
    const directCandidates = [
      this.normalizeString(field.requestFieldName),
      this.normalizeString(field.key),
    ].filter((item): item is string => Boolean(item));

    for (const candidate of directCandidates) {
      if (this.hasRequestPath(body, candidate)) {
        paths.add(candidate);
      }
    }

    const fieldTokens = this.extractStructuredFieldTokens(field);
    for (const path of this.buildStructuredFieldCandidatePaths(body, fieldTokens)) {
      paths.add(path);
    }

    return [...paths];
  }

  private getCaptureFormFieldMappings(
    deliveryContext: UrlDeliveryExecutionContext,
    fieldKey?: string,
    preflightValues?: Record<string, any>,
  ) {
    const preflightSteps = Array.isArray(deliveryContext.runtime?.preflight?.steps)
      ? deliveryContext.runtime.preflight.steps as Array<Record<string, any>>
      : [];

    const staticMappings = preflightSteps
      .filter((step) => this.normalizeString(step?.builtin) === 'capture_form_submit')
      .flatMap((step) => Array.isArray(step?.options?.fieldMappings) ? step.options.fieldMappings : [])
      .filter((mapping) => mapping && typeof mapping === 'object' && !Array.isArray(mapping))
      .filter((mapping) => {
        if (!fieldKey) {
          return true;
        }
        return this.normalizeString(mapping.fieldKey) === this.normalizeString(fieldKey);
      }) as Array<Record<string, any>>;

    const dynamicMappings = Array.isArray(preflightValues?.resolvedFieldMappings)
      ? preflightValues.resolvedFieldMappings
        .filter((mapping) => mapping && typeof mapping === 'object' && !Array.isArray(mapping))
        .filter((mapping) => {
          if (!fieldKey) {
            return true;
          }
          return this.normalizeString((mapping as Record<string, any>).fieldKey) === this.normalizeString(fieldKey);
        }) as Array<Record<string, any>>
      : [];

    return dynamicMappings.length > 0 ? dynamicMappings : staticMappings;
  }

  private collectChoiceAliases(mapping: Record<string, any>, field: RpaFieldBinding) {
    return Array.from(new Set([
      ...this.collectOptionAliases(mapping?.options),
      this.normalizeString(mapping?.target?.label),
    ].filter((item): item is string => Boolean(item))));
  }

  private collectOptionAliases(options: unknown) {
    if (!Array.isArray(options)) {
      return [];
    }

    return Array.from(new Set(options.flatMap((option) => {
      if (typeof option === 'string') {
        const normalized = this.normalizeString(option);
        return normalized ? [normalized] : [];
      }
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        return [];
      }
      return [
        this.normalizeString((option as Record<string, any>).label),
        this.normalizeString((option as Record<string, any>).value),
      ].filter((item): item is string => Boolean(item));
    })));
  }

  private hasRequestPath(target: any, path: string) {
    const normalizedPath = this.normalizeString(path);
    if (!normalizedPath) {
      return false;
    }
    return this.getValueAtRequestPath(target, normalizedPath) !== undefined;
  }

  private extractStructuredFieldTokens(field: Pick<RpaFieldBinding, 'id' | 'selector' | 'requestFieldName'>) {
    const candidates = [
      this.normalizeString(field.id),
      this.normalizeString(field.requestFieldName),
      this.normalizeString(field.selector),
    ].filter((item): item is string => Boolean(item));

    const tokens = new Set<string>();
    for (const candidate of candidates) {
      const matches = candidate.match(/[a-z]+[_-]?\d+/ig) || [];
      for (const matched of matches) {
        const normalized = this.normalizeString(matched);
        if (normalized) {
          tokens.add(normalized);
        }
      }
    }

    return [...tokens];
  }

  private buildStructuredFieldCandidatePaths(
    value: any,
    fieldTokens: string[],
    discoveredRoots?: string[],
  ) {
    if (fieldTokens.length === 0) {
      return [];
    }

    const paths = new Set<string>();
    const roots = discoveredRoots || this.findStructuredFieldContainerRoots(value, fieldTokens);
    for (const path of this.findStructuredFieldKeyPaths(value, fieldTokens)) {
      paths.add(path);
    }

    for (const root of roots) {
      for (const token of fieldTokens) {
        paths.add(root ? `${root}.${token}` : token);
      }
    }

    return [...paths];
  }

  private findStructuredFieldContainerRoots(
    value: any,
    fieldTokens: string[],
    prefix = '',
  ): string[] {
    const roots: string[] = [];
    if (fieldTokens.length === 0) {
      return roots;
    }
    const current = typeof value === 'string' && this.looksLikeJson(value)
      ? this.safeParseJson(value)
      : value;

    if (!current || typeof current !== 'object') {
      return roots;
    }

    const normalizedTokens = new Set(fieldTokens.map((token) => String(token).toLowerCase()));
    if (
      !Array.isArray(current)
      && Object.keys(current).some((key) => normalizedTokens.has(String(key || '').toLowerCase()))
    ) {
      roots.push(prefix);
    }

    if (Array.isArray(current)) {
      current.forEach((child, index) => {
        const nextPrefix = prefix ? `${prefix}.${index}` : String(index);
        roots.push(...this.findStructuredFieldContainerRoots(child, fieldTokens, nextPrefix));
      });
      return [...new Set(roots)];
    }

    for (const [key, child] of Object.entries(current)) {
      if (child === undefined || child === null) {
        continue;
      }
      const childValue = typeof child === 'string' && this.looksLikeJson(child)
        ? this.safeParseJson(child)
        : child;
      if (!childValue || typeof childValue !== 'object') {
        continue;
      }
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      roots.push(...this.findStructuredFieldContainerRoots(childValue, fieldTokens, nextPrefix));
    }

    return [...new Set(roots)];
  }

  private findStructuredFieldKeyPaths(
    value: any,
    fieldTokens: string[],
    prefix = '',
  ): string[] {
    const paths: string[] = [];
    if (fieldTokens.length === 0) {
      return paths;
    }

    const current = typeof value === 'string' && this.looksLikeJson(value)
      ? this.safeParseJson(value)
      : value;
    if (!current || typeof current !== 'object') {
      return paths;
    }

    const normalizedTokens = new Set(fieldTokens.map((token) => String(token).toLowerCase()));
    if (Array.isArray(current)) {
      current.forEach((child, index) => {
        const nextPrefix = prefix ? `${prefix}.${index}` : String(index);
        paths.push(...this.findStructuredFieldKeyPaths(child, fieldTokens, nextPrefix));
      });
      return [...new Set(paths)];
    }

    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = String(key || '').toLowerCase();
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (normalizedTokens.has(normalizedKey)) {
        paths.push(nextPrefix);
      }
      if (child !== undefined && child !== null) {
        paths.push(...this.findStructuredFieldKeyPaths(child, fieldTokens, nextPrefix));
      }
    }

    return [...new Set(paths)];
  }

  private getFieldBindings(
    deliveryContext: UrlDeliveryExecutionContext,
    preflightValues?: Record<string, any>,
  ) {
    const bindings = new Map<string, RpaFieldBinding>();
    const fields = deliveryContext.rpaFlow?.rpaDefinition?.fields;
    if (!Array.isArray(fields)) {
      return this.mergeResolvedFieldBindings(bindings, preflightValues);
    }

    for (const field of fields) {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        continue;
      }
      const key = this.normalizeString((field as RpaFieldBinding).key);
      if (!key) {
        continue;
      }
      bindings.set(key, field as RpaFieldBinding);
    }

    return this.mergeResolvedFieldBindings(bindings, preflightValues);
  }

  private mergeResolvedFieldBindings(
    bindings: Map<string, RpaFieldBinding>,
    preflightValues?: Record<string, any>,
  ) {
    const resolvedBindings = Array.isArray(preflightValues?.resolvedFieldBindings)
      ? preflightValues.resolvedFieldBindings
      : [];

    for (const binding of resolvedBindings) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        continue;
      }
      const resolvedBinding = binding as Record<string, any>;
      const key = this.normalizeString(resolvedBinding.key || resolvedBinding.fieldKey);
      if (!key) {
        continue;
      }
      const current = bindings.get(key) || ({ key } as RpaFieldBinding);
      bindings.set(key, {
        ...current,
        ...resolvedBinding,
        label: this.normalizeString(current.label) || this.normalizeString(resolvedBinding.label),
        key,
      } as RpaFieldBinding);
    }

    return bindings;
  }

  private resolveFieldPatchValue(
    field: RpaFieldBinding,
    patch: RpaFieldRequestPatch,
    context: Record<string, any>,
  ) {
    const sourcePath = this.normalizeString(patch.source) || `formData.${field.key}`;
    const rawValue = this.getNestedValue(context, sourcePath);
    if (this.isEmptyRuntimeValue(rawValue)) {
      return undefined;
    }
    return this.applyPatchTransform(rawValue, patch.transform);
  }

  private applyPatchTransform(value: any, transform?: RpaFieldRequestPatch['transform']) {
    switch (transform) {
      case 'toString':
        return value === undefined || value === null ? value : String(value);
      case 'toNumber':
        return value === undefined || value === null ? value : Number(value);
      case 'toBoolean':
        return value === undefined || value === null ? value : Boolean(value);
      case 'toUpperCase':
        return value === undefined || value === null ? value : String(value).toUpperCase();
      case 'toLowerCase':
        return value === undefined || value === null ? value : String(value).toLowerCase();
      case 'json':
        return value === undefined ? value : JSON.stringify(value);
      case 'joinComma':
        return Array.isArray(value) ? value.join(',') : value;
      case 'joinChineseComma':
        return Array.isArray(value) ? value.join('、') : value;
      default:
        return value;
    }
  }

  private setValueAtRequestPath(target: any, path: string, value: any) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || normalizedPath === '$') {
      return value;
    }

    const segments = normalizedPath.split('.').filter(Boolean);
    if (segments.length === 0) {
      return value;
    }

    const root = this.ensureMutableContainer(target) ?? (/^\d+$/.test(segments[0]) ? [] : {});
    this.assignValueAtSegments(root, segments, value);
    return root;
  }

  private assignValueAtSegments(target: any, segments: string[], value: any) {
    if (segments.length === 0) {
      return;
    }

    const [head, ...rest] = segments;
    const isIndex = /^\d+$/.test(head);
    if (rest.length === 0) {
      if (Array.isArray(target) && isIndex) {
        target[Number(head)] = value;
      } else {
        target[head] = value;
      }
      return;
    }

    const currentValue = Array.isArray(target) && isIndex
      ? target[Number(head)]
      : target[head];
    let nextContainer = this.ensureMutableContainer(currentValue);

    if (!nextContainer) {
      nextContainer = /^\d+$/.test(rest[0]) ? [] : {};
    }

    if (Array.isArray(target) && isIndex) {
      target[Number(head)] = nextContainer;
    } else {
      target[head] = nextContainer;
    }

    this.assignValueAtSegments(nextContainer, rest, value);

    if (typeof currentValue === 'string' && this.looksLikeJson(currentValue)) {
      const serialized = JSON.stringify(nextContainer);
      if (Array.isArray(target) && isIndex) {
        target[Number(head)] = serialized;
      } else {
        target[head] = serialized;
      }
    }
  }

  private getValueAtRequestPath(target: any, path: string) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || normalizedPath === '$') {
      return target;
    }

    const segments = normalizedPath.split('.').filter(Boolean);
    let current = target;
    for (const segment of segments) {
      if (typeof current === 'string' && this.looksLikeJson(current)) {
        current = this.safeParseJson(current);
      }
      if (current === undefined || current === null) {
        return undefined;
      }
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        current = current[Number(segment)];
        continue;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  private ensureMutableContainer(value: any) {
    if (Array.isArray(value)) {
      return [...value];
    }
    if (value && typeof value === 'object') {
      return { ...value };
    }
    if (typeof value === 'string' && this.looksLikeJson(value)) {
      const parsed = this.safeParseJson(value);
      if (parsed && typeof parsed === 'object') {
        return Array.isArray(parsed) ? [...parsed] : { ...parsed };
      }
    }
    return value === undefined || value === null
      ? {}
      : undefined;
  }

  private looksLikeJson(value: string) {
    const trimmed = value.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  private safeParseJson(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private requestContainsValue(target: any, expected: any): boolean {
    if (expected === undefined || expected === null) {
      return false;
    }

    if (Array.isArray(expected)) {
      return expected.every((item) => this.requestContainsValue(target, item));
    }

    if (Array.isArray(target)) {
      return target.some((item) => this.requestContainsValue(item, expected));
    }

    if (typeof target === 'string') {
      if (this.looksLikeJson(target)) {
        const parsed = this.safeParseJson(target);
        if (parsed !== undefined) {
          return this.requestContainsValue(parsed, expected);
        }
      }
      return target.includes(String(expected));
    }

    if (target && typeof target === 'object') {
      return Object.values(target).some((item) => this.requestContainsValue(item, expected));
    }

    return this.valuesRoughlyEqual(target, expected);
  }

  private valuesRoughlyEqual(left: any, right: any) {
    if (Array.isArray(left) || Array.isArray(right)) {
      const leftList = Array.isArray(left) ? left.map((item) => String(item)) : [String(left)];
      const rightList = Array.isArray(right) ? right.map((item) => String(item)) : [String(right)];
      return leftList.length === rightList.length
        && leftList.every((item) => rightList.includes(item));
    }

    if (left === right) {
      return true;
    }

    if (left === undefined || left === null || right === undefined || right === null) {
      return false;
    }

    return String(left) === String(right);
  }

  private isEmptyRuntimeValue(value: any) {
    if (value === undefined || value === null) {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length === 0 || value.every((item) => this.isEmptyRuntimeValue(item));
    }
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    return false;
  }

  private applyMapping(
    mapping: Record<string, string | RpaNetworkMappingRule> | undefined,
    context: Record<string, any>,
  ) {
    if (!mapping) {
      return undefined;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(mapping)) {
      result[key] = typeof value === 'string'
        ? this.interpolateTemplate(value, context)
        : this.resolveRule(value, context);
    }
    return this.flattenUndefined(result);
  }

  private normalizeStringMap(
    mapping: Record<string, string | RpaNetworkMappingRule>,
    context: Record<string, any>,
  ) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(mapping || {})) {
      const resolved = typeof value === 'string'
        ? this.interpolateTemplate(value, context)
        : this.resolveRule(value, context);
      if (resolved !== undefined && resolved !== null && resolved !== '') {
        result[key] = String(resolved);
      }
    }
    return result;
  }

  private resolveRule(rule: RpaNetworkMappingRule, context: Record<string, any>) {
    let value = rule.source
      ? this.getNestedValue(context, rule.source)
      : undefined;
    if (value === undefined) {
      value = rule.default;
    }

    switch (rule.transform) {
      case 'toString':
        return value === undefined || value === null ? value : String(value);
      case 'toNumber':
        return value === undefined || value === null ? value : Number(value);
      case 'toBoolean':
        return value === undefined || value === null ? value : Boolean(value);
      case 'toUpperCase':
        return value === undefined || value === null ? value : String(value).toUpperCase();
      case 'toLowerCase':
        return value === undefined || value === null ? value : String(value).toLowerCase();
      case 'json':
        return value === undefined ? value : JSON.stringify(value);
      default:
        return value;
    }
  }

  private resolveBodyMode(
    value: RpaNetworkRequestDefinition['bodyMode'],
    context: Record<string, any>,
  ) {
    const resolved = this.interpolateTemplate(String(value || 'json'), context).trim().toLowerCase();
    if (resolved === 'form' || resolved === 'multipart') {
      return resolved as 'form' | 'multipart';
    }
    return 'json';
  }

  private mapResponse(definition: RpaNetworkRequestDefinition, responseBody: any) {
    const mapping = definition.responseMapping || {};
    return {
      success: mapping.successPath ? this.getNestedValue(responseBody, mapping.successPath) : undefined,
      submissionId: mapping.submissionIdPath ? this.normalizeString(this.getNestedValue(responseBody, mapping.submissionIdPath)) : undefined,
      status: mapping.statusPath ? this.normalizeString(this.getNestedValue(responseBody, mapping.statusPath)) : undefined,
      message: mapping.messagePath ? this.normalizeString(this.getNestedValue(responseBody, mapping.messagePath)) : undefined,
    };
  }

  private resolveSuccess(
    action: 'submit' | 'queryStatus',
    definition: RpaNetworkRequestDefinition,
    statusCode: number,
    responseMetadata: { success?: any; status?: string; message?: string; submissionId?: string },
  ) {
    if (definition.successMode === 'http2xx') {
      return statusCode >= 200 && statusCode < 400;
    }

    if (definition.responseMapping?.successPath) {
      if (definition.responseMapping.successValue !== undefined) {
        return responseMetadata.success === definition.responseMapping.successValue;
      }
      return responseMetadata.success !== false && responseMetadata.success !== undefined;
    }

    if (statusCode < 200 || statusCode >= 400) {
      return false;
    }

    if (action === 'submit') {
      return Boolean(responseMetadata.submissionId);
    }

    return true;
  }

  private resolveSummary(
    input: UrlNetworkExecutionInput,
    success: boolean,
    message?: string,
  ) {
    if (message) {
      return message;
    }
    const requestDef = input.action === 'submit'
      ? input.context.runtime.networkSubmit
      : input.context.runtime.networkStatus;
    if (input.action === 'submit' && requestDef?.completionKind === 'draft') {
      return `${input.processName} ${success ? 'draft saved' : 'draft save failed'} through URL network runtime`;
    }
    return `${input.processName} ${input.action === 'submit' ? 'submitted' : 'status queried'} through URL network runtime${success ? '' : ' with errors'}`;
  }

  private toArtifactRefs(snapshots: Array<{ snapshotId: string; title?: string; url?: string }> | undefined) {
    return (snapshots || []).map((snapshot) => ({
      id: snapshot.snapshotId,
      kind: 'page_snapshot' as const,
      summary: `${snapshot.title || 'Snapshot'} @ ${snapshot.url || 'unknown'}`,
    }));
  }

  private buildSessionHeaders(auth: Record<string, any>, platformConfig: Record<string, any>, targetUrl?: string) {
    const cookieHeader = this.normalizeString(
      auth.sessionCookie
      ?? auth.cookie
      ?? platformConfig.sessionCookie
      ?? platformConfig.cookie,
    );
    if (cookieHeader) {
      return { Cookie: cookieHeader };
    }

    const derivedCookieHeader = this.buildCookieHeaderFromStorageState(
      platformConfig.storageState ?? auth.storageState,
      targetUrl || platformConfig.cookieOrigin,
    );
    return derivedCookieHeader
      ? { Cookie: derivedCookieHeader }
      : {};
  }

  private buildCookieHeaderFromStorageState(storageState: unknown, fallbackUrl?: string) {
    const parsed = this.parseStorageState(storageState);
    const cookies = Array.isArray(parsed?.cookies) ? parsed.cookies : [];
    if (cookies.length === 0) {
      return undefined;
    }

    const targetUrl = fallbackUrl || this.normalizeString(parsed?.cookies?.[0]?.url);
    if (!targetUrl) {
      return undefined;
    }

    try {
      const url = new URL(targetUrl);
      const visibleCookies = cookies.filter((cookie) => this.matchesCookie(cookie, url));
      return visibleCookies.length > 0
        ? visibleCookies.map((cookie) => `${cookie.name}=${cookie.value || ''}`).join('; ')
        : undefined;
    } catch {
      return undefined;
    }
  }

  private interpolateTemplate(template: string, context: Record<string, any>) {
    return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath) => {
      const value = this.getNestedValue(context, String(rawPath || '').trim());
      return value === undefined || value === null ? '' : String(value);
    });
  }

  private resolveMergeSources(template: Record<string, any>, context: Record<string, any>) {
    const candidate = template.$merge ?? template.__merge__;
    if (!Array.isArray(candidate) || candidate.length === 0) {
      return undefined;
    }

    return candidate.reduce<Record<string, any>>((acc, source) => {
      const resolved = typeof source === 'string'
        ? this.getNestedValue(context, source)
        : this.buildRequestBody(context, source);
      if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
        Object.assign(acc, resolved);
      }
      return acc;
    }, {});
  }

  private getNestedValue(value: any, path: string) {
    return path.split('.').reduce((current, key) => current?.[key], value);
  }

  private normalizeString(value: unknown) {
    if (value === null || value === undefined) {
      return undefined;
    }
    const normalized = typeof value === 'string' ? value.trim() : String(value);
    return normalized || undefined;
  }

  private normalizeAttachmentPayload(value: UrlNetworkAttachmentPayload | null | undefined) {
    if (!value) {
      return null;
    }

    const content = value.content;
    let buffer: Buffer;
    if (Buffer.isBuffer(content)) {
      buffer = content;
    } else if (typeof content === 'string') {
      buffer = Buffer.from(content, 'base64');
    } else {
      return null;
    }

    return {
      filename: this.normalizeString(value.filename || value.name) || 'upload.bin',
      mimeType: this.normalizeString(value.mimeType) || 'application/octet-stream',
      fieldKey: this.normalizeString(value.fieldKey) || undefined,
      buffer,
    };
  }

  private parseStorageState(value: unknown) {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, any>;
  }

  private matchesCookie(cookie: Record<string, any>, url: URL) {
    const cookiePath = String(cookie.path || '/');
    if (!url.pathname.startsWith(cookiePath)) {
      return false;
    }

    if (cookie.url) {
      try {
        return new URL(String(cookie.url)).origin === url.origin;
      } catch {
        return false;
      }
    }

    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  private flattenUndefined(value: any): any {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.flattenUndefined(item));
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, current]) => current !== undefined)
        .map(([key, current]) => [key, this.flattenUndefined(current)]),
    );
  }

  private maskHeaders(headers: any) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers || {})) {
      result[key] = /cookie|authorization/i.test(key)
        ? '***'
        : value;
    }
    return result;
  }

  private maskBody(body: any) {
    if (typeof body === 'string') {
      return body;
    }
    return body;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }

  private isMappingRule(value: unknown) {
    return !!value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (
        Object.prototype.hasOwnProperty.call(value, 'source')
        || Object.prototype.hasOwnProperty.call(value, 'default')
        || Object.prototype.hasOwnProperty.call(value, 'transform')
      );
  }
}
