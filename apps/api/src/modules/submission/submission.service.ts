import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Subject } from 'rxjs';
import {
  buildStatusEventRemoteId,
  DEFAULT_DELIVERY_PATH,
  type DeliveryPath,
} from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RuleService } from '../rule/rule.service';
import { PermissionService } from '../permission/permission.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AttachmentBindingService } from '../attachment/attachment-binding.service';
import { AttachmentService } from '../attachment/attachment.service';
import { DeliveryOrchestratorService } from '../delivery-runtime/delivery-orchestrator.service';
import {
  getSubmissionStatusText,
  isActiveSubmissionStatus,
  isUnsupportedStatusQueryResult,
  mapExternalStatusToSubmissionStatus,
} from '../common/submission-status.util';

export interface SubmissionStatusEvent {
  submissionId: string;
  tenantId: string;
  userId: string;
  status: string;
  statusText: string;
}

interface SubmitInput {
  tenantId: string;
  userId: string;
  draftId: string;
  idempotencyKey: string;
  traceId: string;
  selectedPath?: DeliveryPath | null;
  fallbackPolicy?: DeliveryPath[];
}

export interface SubmitResult {
  submissionId: string;
  status: string;
  oaSubmissionId?: string;
  message: string;
}

@Injectable()
export class SubmissionService {
  readonly statusUpdates$ = new Subject<SubmissionStatusEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ruleService: RuleService,
    private readonly permissionService: PermissionService,
    private readonly processLibraryService: ProcessLibraryService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
    private readonly deliveryOrchestrator: DeliveryOrchestratorService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly attachmentService: AttachmentService,
    private readonly attachmentBindingService: AttachmentBindingService,
    @InjectQueue('submit') private readonly submitQueue: Queue,
  ) {}

  async submit(input: SubmitInput): Promise<SubmitResult> {
    // Check idempotency
    const existing = await this.prisma.submission.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });

    if (existing) {
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId: input.traceId,
        userId: input.userId,
        action: 'submit_idempotent',
        resource: existing.id,
        result: 'success',
        details: { message: 'Idempotent submission, returning existing' },
      });

      return {
        submissionId: existing.id,
        status: existing.status,
        oaSubmissionId: existing.oaSubmissionId || undefined,
        message: '该申请已提交（幂等性检查）',
      };
    }

    // Get draft
    const draft = await this.prisma.processDraft.findUnique({
      where: { id: input.draftId },
      include: {
        template: {
          include: {
            connector: true,
          },
        },
      },
    });

    if (!draft) {
      throw new NotFoundException('Draft not found');
    }

    if (!draft.template) {
      throw new NotFoundException('Draft template not found');
    }

    if (draft.status !== 'ready') {
      throw new BadRequestException('Draft is not ready for submission');
    }

    // Check permission
    const permResult = await this.permissionService.check({
      tenantId: input.tenantId,
      userId: input.userId,
      processCode: draft.template.processCode,
      action: 'submit',
      traceId: input.traceId,
    });

    if (!permResult.allowed) {
      throw new BadRequestException(`Permission denied: ${permResult.reason}`);
    }

    // Check rules
    const rules = (draft.template.rules as any[]) || [];
    const ruleResult = await this.ruleService.checkRules(
      {
        processCode: draft.template.processCode,
        formData: draft.formData as Record<string, any>,
        rules,
      },
      input.traceId,
    );

    if (!ruleResult.valid) {
      const errorMessages = ruleResult.errors
        .filter(e => e.level === 'error')
        .map(e => e.message)
        .join('; ');

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId: input.traceId,
        userId: input.userId,
        action: 'submit_rule_failed',
        resource: input.draftId,
        result: 'error',
        details: { errors: ruleResult.errors },
      });

      throw new BadRequestException(`Rule validation failed: ${errorMessages}`);
    }

    await this.attachmentService.prepareSubmissionPayload({
      tenantId: input.tenantId,
      userId: input.userId,
      formData: draft.formData as Record<string, any>,
      schema: draft.template.schema as any,
    });

    // Create submission record
    const submission = await this.prisma.submission.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        templateId: draft.templateId,
        draftId: draft.id,
        idempotencyKey: input.idempotencyKey,
        formData: draft.formData,
        status: 'pending',
      },
    });
    await this.createSubmissionEvent({
      tenantId: input.tenantId,
      submissionId: submission.id,
      eventType: 'created',
      eventSource: 'internal',
      status: 'pending',
      payload: {
        draftId: draft.id,
        processCode: draft.template.processCode,
      },
    });

    await this.attachmentBindingService.syncSubmissionBindings({
      tenantId: input.tenantId,
      userId: input.userId,
      draftId: draft.id,
      submissionId: submission.id,
      formData: draft.formData as Record<string, any>,
      phase: 'submit',
    });

    // Update draft status
    await this.prisma.processDraft.update({
      where: { id: draft.id },
      data: { status: 'submitted' },
    });

    // Enqueue submission job
    await this.submitQueue.add('execute', {
      submissionId: submission.id,
      connectorId: draft.template.connectorId,
      processCode: draft.template.processCode,
      processName: draft.template.processName,
      formData: draft.formData,
      idempotencyKey: input.idempotencyKey,
      selectedPath: input.selectedPath || null,
      fallbackPolicy: input.fallbackPolicy || [],
    });

    await this.auditService.createLog({
      tenantId: input.tenantId,
      traceId: input.traceId,
      userId: input.userId,
      action: 'submit_created',
      resource: submission.id,
      result: 'success',
      details: {
        processCode: draft.template.processCode,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return {
      submissionId: submission.id,
      status: 'pending',
      message: '申请已提交，正在处理中',
    };
  }

  async executeSubmission(jobData: any) {
    const {
      submissionId,
      connectorId,
      processCode,
      processName,
      formData,
      idempotencyKey,
      selectedPath,
      fallbackPolicy,
    } = jobData;

    try {
      const originalSubmission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: {
          status: true,
          tenantId: true,
          userId: true,
          formData: true,
          template: {
            select: {
              schema: true,
            },
          },
        },
      });
      if (!originalSubmission) {
        throw new NotFoundException('Submission not found');
      }

      const preparedPayload = await this.attachmentService.prepareSubmissionPayload({
        tenantId: originalSubmission.tenantId,
        userId: originalSubmission.userId,
        formData: (originalSubmission.formData as Record<string, any>) || formData,
        schema: originalSubmission.template?.schema as any,
      });
      const execution = await this.deliveryOrchestrator.submit({
        connectorId,
        processCode,
        processName,
        tenantId: originalSubmission.tenantId,
        userId: originalSubmission.userId,
        formData: preparedPayload.sanitizedFormData,
        attachments: preparedPayload.adapterAttachments,
        idempotencyKey,
        selectedPath: selectedPath || null,
        fallbackPolicy: Array.isArray(fallbackPolicy) ? fallbackPolicy : [],
      });
      const result = execution.submitResult;
      const persistedResult = this.buildPersistedSubmitResult(result, {
        connectorId,
        processCode,
      });
      const normalizedOaSubmissionId = this.normalizeOaSubmissionId(result.submissionId);

      // Update submission
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: result.success ? 'submitted' : 'failed',
          oaSubmissionId: normalizedOaSubmissionId,
          submitResult: persistedResult as any,
          errorMsg: result.errorMessage,
          submittedAt: result.success ? new Date() : undefined,
        },
      });
      const persisted = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: {
          tenantId: true,
          oaSubmissionId: true,
          submitResult: true,
          status: true,
        },
      });
      if (persisted) {
        await this.createSubmissionEvent({
          tenantId: persisted.tenantId,
          submissionId,
          eventType: result.success ? 'submitted' : 'submit_failed',
          eventSource: 'internal',
          remoteEventId: persisted.oaSubmissionId || undefined,
          status: persisted.status,
          payload: persisted.submitResult as Record<string, any> | undefined,
        });
      }

      await this.chatSessionProcessService.syncSubmissionStatusToSession({
        submissionId,
        previousSubmissionStatus: originalSubmission.status,
        externalStatus: result.success ? 'submitted' : 'failed',
        payload: persistedResult as Record<string, any>,
        createStatusMessage: false,
      });

      return { success: result.success };
    } catch (error: any) {
      const originalSubmission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
      });
      const failedSubmission = await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'failed',
          errorMsg: error.message,
        },
      });
      await this.createSubmissionEvent({
        tenantId: failedSubmission.tenantId,
        submissionId,
        eventType: 'submit_failed',
        eventSource: 'internal',
        status: 'failed',
        payload: { errorMessage: error.message },
      });

      await this.chatSessionProcessService.syncSubmissionStatusToSession({
        submissionId,
        previousSubmissionStatus: originalSubmission?.status,
        externalStatus: 'failed',
        payload: { errorMessage: error.message },
        createStatusMessage: true,
      });

      throw error;
    }
  }

  async getSubmission(id: string, tenantId?: string) {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        statusRecords: {
          orderBy: { queriedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!submission) return null;

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });

    // Fire-and-forget: don't block the detail response waiting for external OA
    void this.refreshTrackedSubmissionStatuses([submission], new Map([[submission.templateId, template]])).catch(() => {});

    return {
      ...submission,
      processCode: template?.processCode,
      processName: template?.processName,
      processCategory: template?.processCategory,
      statusText: getSubmissionStatusText(submission.status),
      formDataWithLabels: this.buildFormDataWithLabels(
        submission.formData as Record<string, any>,
        template,
      ),
    };
  }

  async listSubmissions(tenantId: string, userId?: string) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        tenantId,
        ...(userId && { userId }),
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const templateIds = [...new Set(submissions.map(s => s.templateId))];
    const templates = await this.prisma.processTemplate.findMany({
      where: { id: { in: templateIds } },
    });
    const templateMap = new Map(templates.map(t => [t.id, t]));

    // Fire-and-forget: refresh statuses in background, don't block the list response
    void this.refreshTrackedSubmissionStatuses(submissions, templateMap).catch(() => {});

    return submissions.map(s => {
      const template = templateMap.get(s.templateId);

      return {
        id: s.id,
        oaSubmissionId: s.oaSubmissionId,
        processCode: template?.processCode,
        processName: template?.processName,
        processCategory: template?.processCategory,
        status: s.status,
        statusText: getSubmissionStatusText(s.status),
        formData: s.formData,
        formDataWithLabels: this.buildFormDataWithLabels(
          s.formData as Record<string, any>,
          template,
        ),
        user: s.user,
        submittedAt: s.submittedAt,
        createdAt: s.createdAt,
      };
    });
  }

  private buildFormDataWithLabels(
    formData: Record<string, any>,
    template: any | null | undefined,
  ) {
    const schema = template?.schema as any;
    const fields: any[] = schema?.fields || [];

    return Object.entries(formData || {}).map(([key, value]) => {
      const field = fields.find((f: any) => f.key === key);
      let displayValue = value;
      if (field?.options && Array.isArray(field.options)) {
        const option = field.options.find((o: any) => o.value === value);
        if (option) displayValue = option.label;
      }
      return {
        key,
        label: field?.label || key,
        value,
        displayValue,
        type: field?.type || 'text',
        required: Boolean(field?.required),
      };
    });
  }

  async cancel(submissionId: string, tenantId: string, userId: string, traceId: string) {
    const submission = await this.getSubmission(submissionId, tenantId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only cancel your own submissions');
    }

    if (!['pending', 'submitted'].includes(submission.status)) {
      throw new BadRequestException('Submission cannot be cancelled in current status');
    }

    if (submission.oaSubmissionId) {
      const adapter = await this.createSubmissionAdapter(submission);
      if (!adapter?.cancel) {
        throw new BadRequestException('Current connector does not support cancel');
      }

      const result = await adapter.cancel(submission.oaSubmissionId);
      this.assertAdapterActionSucceeded('cancel', result, 'Current connector does not support cancel');
    }

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'cancelled' },
    });
    await this.createSubmissionEvent({
      tenantId: submission.tenantId,
      submissionId,
      eventType: 'cancelled',
      eventSource: 'user_action',
      status: 'cancelled',
      payload: { userId },
    });

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId,
      action: 'submission_cancel',
      resource: submissionId,
      result: 'success',
    });

    await this.chatSessionProcessService.syncSubmissionStatusToSession({
      submissionId,
      previousSubmissionStatus: submission.status,
      externalStatus: 'cancelled',
      payload: { userId },
      createStatusMessage: true,
    });

    return { success: true, message: '申请已撤回' };
  }

  async urge(submissionId: string, tenantId: string, userId: string, traceId: string) {
    const submission = await this.getSubmission(submissionId, tenantId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only urge your own submissions');
    }

    if (!submission.oaSubmissionId) {
      throw new BadRequestException('Submission has not been delivered to OA yet');
    }

    const adapter = await this.createSubmissionAdapter(submission);
    if (!adapter?.urge) {
      throw new BadRequestException('Current connector does not support urge');
    }

    const result = await adapter.urge(submission.oaSubmissionId);
    this.assertAdapterActionSucceeded('urge', result, 'Current connector does not support urge');

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId,
      action: 'submission_urge',
      resource: submissionId,
      result: 'success',
    });

    return { success: true, message: '催办成功' };
  }

  async supplement(
    submissionId: string,
    tenantId: string,
    userId: string,
    supplementData: Record<string, any>,
    traceId: string,
  ) {
    const submission = await this.getSubmission(submissionId, tenantId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only supplement your own submissions');
    }

    if (!submission.oaSubmissionId) {
      throw new BadRequestException('Submission has not been delivered to OA yet');
    }

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });
    const preparedPayload = await this.attachmentService.prepareSubmissionPayload({
      tenantId: submission.tenantId,
      userId,
      formData: supplementData,
      schema: template?.schema as any,
    });
    const adapter = await this.createSubmissionAdapter(submission);
    if (!adapter?.supplement) {
      throw new BadRequestException('Current connector does not support supplement');
    }

    const result = await adapter.supplement({
      submissionId: submission.oaSubmissionId,
      supplementData: preparedPayload.sanitizedFormData,
      attachments: preparedPayload.adapterAttachments,
    });
    this.assertAdapterActionSucceeded(
      'supplement',
      result,
      'Current connector does not support supplement',
    );

    await this.attachmentBindingService.syncSubmissionBindings({
      tenantId: submission.tenantId,
      userId,
      draftId: submission.draftId || undefined,
      submissionId,
      formData: supplementData,
      phase: 'supplement',
    });

    await this.createSubmissionEvent({
      tenantId: submission.tenantId,
      submissionId,
      eventType: 'supplement_requested',
      eventSource: 'user_action',
      status: submission.status,
      payload: { supplementData },
    });
    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId,
      action: 'submission_supplement',
      resource: submissionId,
      result: 'success',
      details: { supplementData },
    });

    return { success: true, message: '补件成功' };
  }

  async delegate(
    submissionId: string,
    tenantId: string,
    userId: string,
    targetUserId: string,
    reason: string,
    traceId: string,
  ) {
    const submission = await this.getSubmission(submissionId, tenantId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only delegate your own submissions');
    }

    if (!submission.oaSubmissionId) {
      throw new BadRequestException('Submission has not been delivered to OA yet');
    }

    const adapter = await this.createSubmissionAdapter(submission);
    if (!adapter?.delegate) {
      throw new BadRequestException('Current connector does not support delegate');
    }

    const result = await adapter.delegate({
      submissionId: submission.oaSubmissionId,
      targetUserId,
      reason,
    });
    this.assertAdapterActionSucceeded(
      'delegate',
      result,
      'Current connector does not support delegate',
    );

    await this.createSubmissionEvent({
      tenantId: submission.tenantId,
      submissionId,
      eventType: 'delegate_requested',
      eventSource: 'user_action',
      status: submission.status,
      payload: { targetUserId, reason },
    });
    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId,
      action: 'submission_delegate',
      resource: submissionId,
      result: 'success',
      details: { targetUserId, reason },
    });

    return { success: true, message: '转办成功' };
  }

  private async createSubmissionAdapter(submission: {
    templateId: string;
    processCode?: string | null;
    processName?: string | null;
  }) {
    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });
    if (!template) {
      return null;
    }

    return this.adapterRuntimeService.createAdapterForConnector(template.connectorId, [
      {
        flowCode: submission.processCode || template.processCode,
        flowName: submission.processName || template.processName || submission.processCode || 'flow',
      },
    ]);
  }

  private assertAdapterActionSucceeded(
    action: 'cancel' | 'urge' | 'supplement' | 'delegate',
    result: { success: boolean; message?: string } | null | undefined,
    defaultMessage: string,
  ) {
    if (result?.success) {
      return;
    }

    throw new BadRequestException(result?.message || defaultMessage || `Submission ${action} failed`);
  }

  private async createSubmissionEvent(input: {
    tenantId: string;
    submissionId: string;
    eventType: string;
    eventSource: string;
    status: string;
    remoteEventId?: string;
    payload?: Record<string, any>;
  }) {
    return this.prisma.submissionEvent.create({
      data: {
        tenantId: input.tenantId,
        submissionId: input.submissionId,
        eventType: input.eventType,
        eventSource: input.eventSource,
        remoteEventId: input.remoteEventId,
        eventTime: new Date(),
        status: input.status,
        payload: input.payload,
      },
    });
  }

  private normalizeOaSubmissionId(value: unknown): string | undefined {
    if (value === null || value === undefined) {
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

  private buildPersistedSubmitResult(
    result: Record<string, any>,
    context: {
      connectorId: string;
      processCode: string;
    },
  ) {
    const metadata = ((result.metadata as Record<string, any> | undefined) || {});
    return {
        ...result,
        metadata: {
          ...metadata,
          connectorId: metadata.connectorId || context.connectorId,
          flowCode: metadata.flowCode || context.processCode,
          deliveryPath: metadata.deliveryPath || DEFAULT_DELIVERY_PATH,
        },
      };
  }

  private async refreshTrackedSubmissionStatuses(
    submissions: Array<{
      id: string;
      tenantId: string;
      userId: string;
      templateId: string;
      status: string;
      oaSubmissionId?: string | null;
      statusRecords?: Array<{
        id?: string;
        submissionId?: string;
        status: string;
        statusDetail?: any;
        queriedAt: Date;
      }>;
    }>,
    templateMap: Map<string, {
      connectorId?: string | null;
      processCode?: string | null;
      processName?: string | null;
    } | null | undefined>,
  ) {
    const adapterPromises = new Map<string, Promise<any>>();

    await Promise.allSettled(
      submissions.map(async (submission) => {
        if (!isActiveSubmissionStatus(submission.status) || !submission.oaSubmissionId) {
          return;
        }

        const template = templateMap.get(submission.templateId);
        const connectorId = template?.connectorId;
        if (!connectorId) {
          return;
        }
        const adapterKey = `${connectorId}:${template?.processCode || '*'}`;

        try {
          let adapterPromise = adapterPromises.get(adapterKey);
          if (!adapterPromise) {
            adapterPromise = this.adapterRuntimeService.createAdapterForConnector(
              connectorId,
              template?.processCode
                ? [{
                    flowCode: template.processCode,
                    flowName: template.processName || template.processCode,
                  }]
                : [],
            );
            adapterPromises.set(adapterKey, adapterPromise);
          }

          const adapter = await adapterPromise;
          const previousStatus = submission.status;
          const result = await adapter.queryStatus(submission.oaSubmissionId);
          if (isUnsupportedStatusQueryResult(result)) {
            return;
          }
          const mappedStatus = mapExternalStatusToSubmissionStatus(result.status, previousStatus);
          const queriedAt = new Date();
          const remoteEventId = buildStatusEventRemoteId(
            submission.oaSubmissionId,
            result as Record<string, any>,
          );

          const eventCreated = await this.createSubmissionEventIfNew({
            data: {
              tenantId: submission.tenantId,
              submissionId: submission.id,
              eventType: 'status_list_refreshed',
              eventSource: 'oa_pull',
              remoteEventId,
              eventTime: queriedAt,
              status: result.status,
              payload: result as any,
            },
          });

          if (eventCreated) {
            await this.prisma.submissionStatus.create({
              data: {
                submissionId: submission.id,
                status: result.status,
                statusDetail: result as any,
              },
            });

            if (Array.isArray(submission.statusRecords)) {
              submission.statusRecords = [
                {
                  submissionId: submission.id,
                  status: result.status,
                  statusDetail: result as any,
                  queriedAt,
                },
                ...submission.statusRecords,
              ];
            }
          }

          if (mappedStatus !== submission.status) {
            await this.prisma.submission.update({
              where: { id: submission.id },
              data: { status: mappedStatus },
            });
            submission.status = mappedStatus;
            this.statusUpdates$.next({
              submissionId: submission.id,
              tenantId: submission.tenantId,
              userId: submission.userId,
              status: mappedStatus,
              statusText: getSubmissionStatusText(mappedStatus),
            });
          }

          if (eventCreated || mappedStatus !== previousStatus) {
            await this.chatSessionProcessService.syncSubmissionStatusToSession({
              submissionId: submission.id,
              previousSubmissionStatus: previousStatus,
              externalStatus: result.status,
              payload: result as Record<string, any>,
              createStatusMessage: eventCreated,
            });
          }
        } catch {
          // Swallow refresh failures so list/detail queries still work.
        }
      }),
    );
  }

  private async createSubmissionEventIfNew(input: {
    data: Prisma.SubmissionEventUncheckedCreateInput;
  }) {
    try {
      await this.prisma.submissionEvent.create(input);
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }
}
