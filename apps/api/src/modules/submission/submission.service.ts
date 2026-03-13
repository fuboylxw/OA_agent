import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { buildStatusEventRemoteId } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RuleService } from '../rule/rule.service';
import { PermissionService } from '../permission/permission.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AttachmentBindingService } from '../attachment/attachment-binding.service';
import { AttachmentService } from '../attachment/attachment.service';
import {
  getSubmissionStatusText,
  isActiveSubmissionStatus,
  mapExternalStatusToSubmissionStatus,
} from '../common/submission-status.util';

interface SubmitInput {
  tenantId: string;
  userId: string;
  draftId: string;
  idempotencyKey: string;
  traceId: string;
}

export interface SubmitResult {
  submissionId: string;
  status: string;
  oaSubmissionId?: string;
  message: string;
}

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ruleService: RuleService,
    private readonly permissionService: PermissionService,
    private readonly processLibraryService: ProcessLibraryService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
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
      formData: draft.formData,
      idempotencyKey: input.idempotencyKey,
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
    const { submissionId, connectorId, processCode, formData, idempotencyKey } = jobData;

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
      const adapter = await this.adapterRuntimeService.createAdapterForConnector(
        connectorId,
        [{ flowCode: processCode, flowName: processCode }],
      );

      // Submit to OA
      const result = await adapter.submit({
        flowCode: processCode,
        formData: preparedPayload.sanitizedFormData,
        idempotencyKey,
        attachments: preparedPayload.adapterAttachments,
      });

      // Update submission
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: result.success ? 'submitted' : 'failed',
          oaSubmissionId: result.submissionId,
          submitResult: result as any,
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
        payload: result as Record<string, any>,
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

  async getSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
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

    await this.refreshTrackedSubmissionStatuses([submission], new Map([[submission.templateId, template]]));

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

    await this.refreshTrackedSubmissionStatuses(submissions, templateMap);

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

    return Object.entries(formData).map(([key, value]) => {
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

  async cancel(submissionId: string, userId: string, traceId: string) {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only cancel your own submissions');
    }

    if (!['pending', 'submitted'].includes(submission.status)) {
      throw new BadRequestException('Submission cannot be cancelled in current status');
    }

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });
    const adapter = template
      ? await this.adapterRuntimeService.createAdapterForConnector(template.connectorId, [
          { flowCode: submission.processCode, flowName: submission.processName || submission.processCode || 'flow' },
        ])
      : null;
    if (adapter?.cancel && submission.oaSubmissionId) {
      await adapter.cancel(submission.oaSubmissionId);
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

  async urge(submissionId: string, userId: string, traceId: string) {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only urge your own submissions');
    }

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });
    const adapter = template
      ? await this.adapterRuntimeService.createAdapterForConnector(template.connectorId, [
          { flowCode: submission.processCode, flowName: submission.processName || submission.processCode || 'flow' },
        ])
      : null;
    if (adapter?.urge && submission.oaSubmissionId) {
      await adapter.urge(submission.oaSubmissionId);
    }

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

  async supplement(submissionId: string, userId: string, supplementData: Record<string, any>, traceId: string) {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only supplement your own submissions');
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
    const adapter = template
      ? await this.adapterRuntimeService.createAdapterForConnector(template.connectorId, [
          { flowCode: submission.processCode, flowName: submission.processName || submission.processCode || 'flow' },
        ])
      : null;
    if (adapter?.supplement && submission.oaSubmissionId) {
      await adapter.supplement({
        submissionId: submission.oaSubmissionId,
        supplementData: preparedPayload.sanitizedFormData,
        attachments: preparedPayload.adapterAttachments,
      });
    }

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

  async delegate(submissionId: string, userId: string, targetUserId: string, reason: string, traceId: string) {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.userId !== userId) {
      throw new BadRequestException('You can only delegate your own submissions');
    }

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
    });
    const adapter = template
      ? await this.adapterRuntimeService.createAdapterForConnector(template.connectorId, [
          { flowCode: submission.processCode, flowName: submission.processName || submission.processCode || 'flow' },
        ])
      : null;
    if (adapter?.delegate && submission.oaSubmissionId) {
      await adapter.delegate({
        submissionId: submission.oaSubmissionId,
        targetUserId,
        reason,
      });
    }

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

  private async refreshTrackedSubmissionStatuses(
    submissions: Array<{
      id: string;
      tenantId: string;
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
    templateMap: Map<string, { connectorId?: string | null } | null | undefined>,
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

        try {
          let adapterPromise = adapterPromises.get(connectorId);
          if (!adapterPromise) {
            adapterPromise = this.adapterRuntimeService.createAdapterForConnector(connectorId, []);
            adapterPromises.set(connectorId, adapterPromise);
          }

          const adapter = await adapterPromise;
          const previousStatus = submission.status;
          const result = await adapter.queryStatus(submission.oaSubmissionId);
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
