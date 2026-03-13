import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AuditService } from '../audit/audit.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { mapExternalStatusToSubmissionStatus } from '../common/submission-status.util';

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly auditService: AuditService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
    @InjectQueue('webhook') private readonly webhookQueue: Queue,
  ) {}

  async receive(
    connectorId: string,
    headers: Record<string, string | string[] | undefined>,
    payload: Record<string, any>,
    rawBody?: string,
  ) {
    const connector = await this.adapterRuntimeService.getConnectorWithSecrets(connectorId);
    const resolvedAuthConfig = await this.adapterRuntimeService.resolveAuthConfig(connector);
    const webhookConfig = this.getWebhookConfig(connector);

    this.verifySignatureIfConfigured(headers, payload, rawBody, resolvedAuthConfig, webhookConfig);

    const eventType = this.extractEventType(payload, webhookConfig);
    const dedupeKey = this.buildDedupeKey(connector.id, headers, payload, eventType, webhookConfig);
    const normalizedHeaders = this.normalizeHeaders(headers);

    const existing = await this.prisma.webhookInbox.findUnique({
      where: { dedupeKey },
    });
    if (existing) {
      return {
        inboxId: existing.id,
        dedupeKey,
        duplicate: true,
        processStatus: existing.processStatus,
      };
    }

    const inbox = await this.prisma.webhookInbox.create({
      data: {
        tenantId: connector.tenantId,
        connectorId: connector.id,
        eventType,
        dedupeKey,
        headers: normalizedHeaders,
        payload,
      },
    });

    await this.webhookQueue.add(
      'process',
      { inboxId: inbox.id },
      {
        jobId: `webhook:${inbox.id}`,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    await this.auditService.createLog({
      tenantId: connector.tenantId,
      traceId: `webhook-${inbox.id}`,
      action: 'webhook_received',
      resource: connector.id,
      result: 'success',
      details: {
        inboxId: inbox.id,
        eventType,
        dedupeKey,
      },
    });

    return {
      inboxId: inbox.id,
      dedupeKey,
      duplicate: false,
      processStatus: 'pending',
    };
  }

  async processInbox(inboxId: string) {
    const inbox = await this.prisma.webhookInbox.findUnique({
      where: { id: inboxId },
      include: {
        connector: {
          include: {
            capability: true,
          },
        },
      },
    });

    if (!inbox) {
      throw new NotFoundException('Webhook inbox not found');
    }

    if (inbox.processStatus === 'processed') {
      return inbox;
    }

    const payload = inbox.payload as Record<string, any>;
    const webhookConfig = this.getWebhookConfig(inbox.connector);
    const externalSubmissionId = this.extractExternalSubmissionId(payload, webhookConfig);
    const eventType = this.coerceString(inbox.eventType) || this.extractEventType(payload, webhookConfig);
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

    const previousStatus = submission.status;
    const nextSubmissionStatus = mapExternalStatusToSubmissionStatus(eventStatus, previousStatus);

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

    if (eventCreated || nextSubmissionStatus !== previousStatus) {
      await this.chatSessionProcessService.syncSubmissionStatusToSession({
        submissionId: submission.id,
        previousSubmissionStatus: previousStatus,
        externalStatus: eventStatus,
        payload,
        createStatusMessage: eventCreated,
      });
    }

    const updated = await this.prisma.webhookInbox.update({
      where: { id: inbox.id },
      data: {
        processStatus: 'processed',
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId: `webhook-${inbox.id}`,
      userId: submission.userId,
      action: 'webhook_processed',
      resource: submission.id,
      result: 'success',
      details: {
        eventType,
        eventStatus,
        externalSubmissionId,
        remoteEventId,
        duplicateEvent: !eventCreated,
      },
    });

    return updated;
  }

  async listInbox(tenantId: string, connectorId?: string, processStatus?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return this.prisma.webhookInbox.findMany({
      where: {
        tenantId,
        ...(connectorId && { connectorId }),
        ...(processStatus && { processStatus }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
  }

  async getInbox(id: string) {
    const inbox = await this.prisma.webhookInbox.findUnique({
      where: { id },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
            oaType: true,
          },
        },
      },
    });

    if (!inbox) {
      throw new NotFoundException('Webhook inbox not found');
    }

    return inbox;
  }

  async getConfig(connectorId: string) {
    const connector = await this.adapterRuntimeService.getConnectorWithSecrets(connectorId);
    return this.getWebhookConfig(connector);
  }

  async updateConfig(
    connectorId: string,
    config: Record<string, any>,
  ) {
    const connector = await this.adapterRuntimeService.getConnectorWithSecrets(connectorId);
    const currentMetadata = (connector.capability?.metadata as Record<string, any> | null) || {};
    const updatedMetadata = {
      ...currentMetadata,
      webhookConfig: {
        ...(currentMetadata.webhookConfig || {}),
        ...config,
      },
    };

    await this.prisma.connectorCapability.upsert({
      where: { connectorId },
      create: {
        tenantId: connector.tenantId,
        connectorId,
        supportsDiscovery: true,
        supportsWebhook: true,
        metadata: updatedMetadata,
      },
      update: {
        supportsWebhook: true,
        metadata: updatedMetadata,
      },
    });

    return updatedMetadata.webhookConfig;
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

  private verifySignatureIfConfigured(
    headers: Record<string, string | string[] | undefined>,
    payload: Record<string, any>,
    rawBody: string | undefined,
    authConfig: Record<string, any>,
    webhookConfig: Record<string, any>,
  ) {
    const secretField = webhookConfig.secretField || 'webhookSecret';
    const secret = authConfig[secretField] || authConfig.webhookSecret || authConfig.webhookSigningSecret;
    const requireSignature = webhookConfig.requireSignature === undefined
      ? Boolean(secret)
      : webhookConfig.requireSignature !== false;

    if (!requireSignature) {
      return;
    }

    if (!secret) {
      throw new BadRequestException('Webhook signature validation is enabled but secret is not configured');
    }

    const headerNames = webhookConfig.signatureHeader
      ? [String(webhookConfig.signatureHeader)]
      : ['x-webhook-signature', 'x-signature', 'x-hub-signature-256'];
    const providedSignature = this.readHeader(headers, headerNames);

    if (!providedSignature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const prefix = webhookConfig.signaturePrefix ?? 'sha256=';
    const algorithm = this.coerceString(webhookConfig.signatureAlgorithm) || 'sha256';
    const encoding = this.resolveSignatureEncoding(webhookConfig.signatureEncoding);
    const payloadMode = webhookConfig.signaturePayloadMode === 'raw' ? 'raw' : 'json';
    const signature = prefix && providedSignature.startsWith(prefix)
      ? providedSignature.slice(prefix.length)
      : providedSignature;
    const computed = createHmac(algorithm, String(secret))
      .update(payloadMode === 'raw' ? (rawBody || JSON.stringify(payload)) : JSON.stringify(payload))
      .digest(encoding as 'hex' | 'base64');

    const left = Buffer.from(signature, encoding as 'hex' | 'base64');
    const right = Buffer.from(computed, encoding as 'hex' | 'base64');
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private buildDedupeKey(
    connectorId: string,
    headers: Record<string, string | string[] | undefined>,
    payload: Record<string, any>,
    eventType: string,
    webhookConfig: Record<string, any>,
  ) {
    const explicit = this.readHeader(headers, ['x-event-id', 'x-request-id'])
      || this.readByPath(payload, webhookConfig.dedupeKeyPath)
      || payload.eventId
      || payload.requestId
      || payload.id;

    if (explicit) {
      return `${connectorId}:${explicit}`;
    }

    return createHash('sha256')
      .update(JSON.stringify({
        connectorId,
        eventType,
        payload,
      }))
      .digest('hex');
  }

  private normalizeHeaders(headers: Record<string, string | string[] | undefined>) {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(',') : (value ?? ''),
      ]),
    );
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    names: string[],
  ) {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );

    for (const name of names) {
      const value = normalizedHeaders[name.toLowerCase()];
      if (Array.isArray(value)) {
        return value[0];
      }
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
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

  private extractEventTime(payload: Record<string, any>, webhookConfig: Record<string, any>) {
    const raw = this.readByPath(payload, webhookConfig.eventTimePath)
      || payload.eventTime || payload.timestamp || payload.occurredAt || payload.createdAt;
    if (!raw) {
      return new Date();
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date() : date;
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

  private resolveSignatureEncoding(value: unknown): 'hex' | 'base64' {
    return this.coerceString(value) === 'base64' ? 'base64' : 'hex';
  }

  private isDuplicateSubmissionEventError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
