import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RuleService } from '../rule/rule.service';
import { PermissionService } from '../permission/permission.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { ConnectorService } from '../connector/connector.service';
import { AdapterFactory } from '@uniflow/oa-adapters';

interface SubmitInput {
  tenantId: string;
  userId: string;
  draftId: string;
  idempotencyKey: string;
  traceId: string;
}

interface SubmitResult {
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
    private readonly connectorService: ConnectorService,
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
      // Get connector
      const connector = await this.connectorService.get(connectorId);

      // Create adapter
      const adapter = AdapterFactory.createMockAdapter(
        connector.oaType as any,
        [{ flowCode: processCode, flowName: processCode }],
      );

      // Submit to OA
      const result = await adapter.submit({
        flowCode: processCode,
        formData,
        idempotencyKey,
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

      return { success: result.success };
    } catch (error: any) {
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: 'failed',
          errorMsg: error.message,
        },
      });

      throw error;
    }
  }

  async getSubmission(id: string) {
    return this.prisma.submission.findUnique({
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
  }

  async listSubmissions(tenantId: string, userId?: string) {
    return this.prisma.submission.findMany({
      where: {
        tenantId,
        ...(userId && { userId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
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

    // TODO: Call OA adapter to cancel
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'cancelled' },
    });

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId,
      action: 'submission_cancel',
      resource: submissionId,
      result: 'success',
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

    // TODO: Call OA adapter to urge
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

    // TODO: Call OA adapter to supplement
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

    // TODO: Call OA adapter to delegate
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
}
