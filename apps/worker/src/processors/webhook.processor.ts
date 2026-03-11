import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../services/prisma.service';

@Processor('webhook')
@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('process')
  async handleWebhook(job: Job<{ inboxId: string }>) {
    const inbox = await this.prisma.webhookInbox.findUnique({
      where: { id: job.data.inboxId },
      include: {
        connector: {
          include: {
            capability: true,
          },
        },
      },
    });

    if (!inbox) {
      throw new Error(`Webhook inbox ${job.data.inboxId} not found`);
    }

    if (inbox.processStatus === 'processed') {
      return inbox;
    }

    const payload = inbox.payload as Record<string, any>;
    const webhookConfig = this.getWebhookConfig(inbox.connector);
    const externalSubmissionId = this.extractExternalSubmissionId(payload, webhookConfig);
    const eventType = this.coerceString(inbox.eventType)
      || this.extractEventType(payload, webhookConfig);
    const eventStatus = this.extractStatus(payload, webhookConfig);
    const remoteEventId = this.extractRemoteEventId(payload, inbox.dedupeKey, webhookConfig);

    if (!externalSubmissionId) {
      return this.markInboxFailed(inbox.id, 'Cannot map webhook payload to submission identifier');
    }

    const submission = await this.prisma.submission.findFirst({
      where: {
        tenantId: inbox.tenantId,
        OR: [
          { oaSubmissionId: externalSubmissionId },
          { id: externalSubmissionId },
        ],
      },
    });

    if (!submission) {
      return this.markInboxFailed(inbox.id, `Submission not found for external id ${externalSubmissionId}`);
    }

    const nextSubmissionStatus = this.mapWebhookStatusToSubmissionStatus(eventStatus, submission.status);
    const eventCreated = await this.createSubmissionEvent({
      tenantId: submission.tenantId,
      submissionId: submission.id,
      eventType,
      eventSource: 'oa_webhook',
      remoteEventId,
      eventTime: this.extractEventTime(payload, webhookConfig),
      status: eventStatus,
      payload,
    });

    if (eventCreated) {
      await this.prisma.submissionStatus.create({
        data: {
          submissionId: submission.id,
          status: eventStatus,
          statusDetail: payload,
        },
      });
    }

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: nextSubmissionStatus,
      },
    });

    const updated = await this.prisma.webhookInbox.update({
      where: { id: inbox.id },
      data: {
        processStatus: 'processed',
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    this.logger.log(
      `Processed webhook inbox ${inbox.id} for submission ${submission.id} (remoteEventId=${remoteEventId}, duplicate=${!eventCreated})`,
    );
    return updated;
  }

  private async markInboxFailed(id: string, errorMessage: string) {
    return this.prisma.webhookInbox.update({
      where: { id },
      data: {
        processStatus: 'failed',
        processedAt: new Date(),
        errorMessage,
      },
    });
  }

  private async createSubmissionEvent(data: Prisma.SubmissionEventUncheckedCreateInput) {
    try {
      await this.prisma.submissionEvent.create({ data });
      return true;
    } catch (error) {
      if (this.isDuplicateSubmissionEventError(error)) {
        return false;
      }
      throw error;
    }
  }

  private extractExternalSubmissionId(payload: Record<string, any>, webhookConfig: Record<string, any>) {
    return this.coerceString(
      this.readByPath(payload, webhookConfig.submissionIdPath)
      || payload.oaSubmissionId
      || payload.submissionId
      || payload.workId
      || payload.businessKey
      || payload.id,
    );
  }

  private extractEventType(payload: Record<string, any>, webhookConfig: Record<string, any>) {
    return this.coerceString(
      this.readByPath(payload, webhookConfig.eventTypePath)
      || payload.eventType
      || payload.type
      || payload.status
      || 'oa_webhook',
    ) || 'oa_webhook';
  }

  private extractStatus(payload: Record<string, any>, webhookConfig: Record<string, any>) {
    return this.coerceString(
      this.readByPath(payload, webhookConfig.statusPath)
      || payload.status
      || payload.state
      || payload.result
      || payload.eventType
      || 'unknown',
    ) || 'unknown';
  }

  private extractRemoteEventId(
    payload: Record<string, any>,
    fallback: string,
    webhookConfig: Record<string, any>,
  ) {
    return this.coerceString(
      this.readByPath(payload, webhookConfig.remoteEventIdPath)
      || payload.eventId
      || payload.requestId
      || payload.logId
      || fallback,
    ) || fallback;
  }

  private extractEventTime(payload: Record<string, any>, webhookConfig: Record<string, any>) {
    const raw = this.readByPath(payload, webhookConfig.eventTimePath)
      || payload.eventTime || payload.timestamp || payload.occurredAt || payload.createdAt;
    if (!raw) {
      return new Date();
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private mapWebhookStatusToSubmissionStatus(webhookStatus: string, fallbackStatus: string) {
    const normalized = (webhookStatus || '').toLowerCase();

    if (!normalized) return fallbackStatus;
    if (['error', 'failed', 'failure'].includes(normalized)) return 'failed';
    if (['cancelled', 'canceled', 'revoked'].includes(normalized)) return 'cancelled';
    if (normalized.includes('reject')) return 'failed';
    if (normalized.includes('approve') || normalized.includes('finish') || normalized.includes('complete')) {
      return 'submitted';
    }
    if (normalized.includes('pending') || normalized.includes('review') || normalized.includes('process')) {
      return 'submitted';
    }

    return fallbackStatus;
  }

  private getWebhookConfig(connector: { capability?: { metadata?: any } | null }) {
    const metadata = (connector.capability?.metadata as Record<string, any> | null) || {};
    return (metadata.webhookConfig as Record<string, any> | undefined) || {};
  }

  private readByPath(payload: Record<string, any>, path?: string) {
    if (!path) {
      return undefined;
    }

    return path.split('.').reduce<any>((current, key) => current?.[key], payload);
  }

  private coerceString(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return typeof value === 'string' ? value : String(value);
  }

  private isDuplicateSubmissionEventError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
