import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import {
  ApiUploadResult,
  ApiUploadService,
  UploadApiFileDto,
} from './api-upload.service';
import {
  ApiUploadRepairAttemptResult,
  ApiUploadRepairService,
} from './api-upload-repair.service';

const API_UPLOAD_SENSITIVE_AUTH_KEYS = new Set([
  'username',
  'password',
  'token',
  'apiKey',
  'appSecret',
  'accessToken',
  'refreshToken',
  'secret',
  'serviceToken',
  'ticketHeaderValue',
]);

export interface UploadApiWithRepairDto extends UploadApiFileDto {
  sourceName?: string;
  maxRepairAttempts?: number;
}

export interface UploadApiWithRepairResult extends ApiUploadResult {
  jobId: string;
  repair: {
    attempted: boolean;
    accepted: boolean;
    attemptCount: number;
    acceptedAttemptNo?: number;
    acceptedDocType?: string;
    validationScore?: number;
  };
}

export interface ApiUploadJobViewOptions {
  includeContent?: boolean;
}

@Injectable()
export class ApiUploadJobService {
  private readonly logger = new Logger(ApiUploadJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiUploadRepairService: ApiUploadRepairService,
    private readonly apiUploadService: ApiUploadService,
  ) {}

  async uploadAndProcessWithRepair(
    dto: UploadApiWithRepairDto,
  ): Promise<UploadApiWithRepairResult> {
    const job = await this.createJob(dto);

    try {
      return await this.runJob(job.id, dto.maxRepairAttempts);
    } catch (error) {
      await this.ensureJobFailureRecorded(job.id, error);
      throw error;
    }
  }

  async createAndRunJob(dto: UploadApiWithRepairDto) {
    const job = await this.createJob(dto);

    try {
      await this.runJob(job.id, dto.maxRepairAttempts);
      return this.getJob(job.id, dto.tenantId, { includeContent: false });
    } catch (error) {
      await this.ensureJobFailureRecorded(job.id, error);
      return this.getJob(job.id, dto.tenantId, { includeContent: false });
    }
  }

  async startJob(dto: UploadApiWithRepairDto) {
    const job = await this.createJob(dto);

    void this.runJob(job.id, dto.maxRepairAttempts).catch(async (error) => {
      await this.ensureJobFailureRecorded(job.id, error);
    });

    return this.getJob(job.id, dto.tenantId, { includeContent: false });
  }

  async getJob(
    jobId: string,
    tenantId: string,
    options: ApiUploadJobViewOptions = {},
  ) {
    const job = await this.prisma.apiUploadJob.findFirst({
      where: { id: jobId, tenantId },
      include: {
        attempts: {
          orderBy: { attemptNo: 'asc' },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`API upload job ${jobId} not found`);
    }

    return {
      ...this.sanitizeJob(job, options),
      repairSummary: {
        attemptCount: job.attempts.length,
        accepted: job.finalDecision === 'accepted',
      },
    };
  }

  async getAttempts(
    jobId: string,
    tenantId: string,
    options: ApiUploadJobViewOptions = {},
  ) {
    const job = await this.prisma.apiUploadJob.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true },
    });

    if (!job) {
      throw new NotFoundException(`API upload job ${jobId} not found`);
    }

    const attempts = await this.prisma.apiUploadAttempt.findMany({
      where: { jobId },
      orderBy: { attemptNo: 'asc' },
    });

    return attempts.map((attempt) => this.sanitizeAttempt(attempt, options));
  }

  private async createJob(dto: UploadApiWithRepairDto) {
    if (!dto.docContent?.trim()) {
      throw new BadRequestException('API document content is required');
    }

    const connector = await this.prisma.connector.findUnique({
      where: { id: dto.connectorId },
      select: { id: true, tenantId: true, baseUrl: true },
    });

    if (!connector) {
      throw new NotFoundException(`Connector ${dto.connectorId} not found`);
    }

    if (connector.tenantId !== dto.tenantId) {
      throw new BadRequestException(
        `Connector ${dto.connectorId} does not belong to tenant ${dto.tenantId}`,
      );
    }

    const oaUrl = dto.oaUrl || connector.baseUrl;
    if (!oaUrl) {
      throw new BadRequestException('OA base URL is required');
    }

    return this.prisma.apiUploadJob.create({
      data: {
        tenantId: dto.tenantId,
        connectorId: dto.connectorId,
        sourceName: dto.sourceName,
        sourceHash: this.computeHash(dto.docContent),
        sourceContent: dto.docContent,
        docType: dto.docType,
        oaUrl,
        authConfig: dto.authConfig ?? undefined,
        autoValidate: Boolean(dto.autoValidate),
        autoGenerateMcp: Boolean(dto.autoGenerateMcp),
        status: 'REPAIRING',
      },
    });
  }

  private async runJob(
    jobId: string,
    maxRepairAttempts?: number,
  ): Promise<UploadApiWithRepairResult> {
    const job = await this.prisma.apiUploadJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`API upload job ${jobId} not found`);
    }

    const repairResult = await this.apiUploadRepairService.runRepairLoop({
      tenantId: job.tenantId,
      connectorId: job.connectorId,
      sourceName: job.sourceName || undefined,
      docType: job.docType as UploadApiFileDto['docType'],
      docContent: job.sourceContent,
      oaUrl: job.oaUrl || '',
      maxAttempts: maxRepairAttempts,
    });

    await this.persistAttempts(job.id, job.sourceContent, repairResult.attempts, Boolean(repairResult.accepted));

    if (!repairResult.accepted) {
      await this.prisma.apiUploadJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          currentAttemptNo: repairResult.attempts.length,
          finalDecision: 'rejected',
          finalErrorType: repairResult.finalErrorType || 'repair_failed',
          finalErrorMessage:
            repairResult.finalErrorMessage
            || 'Automatic repair could not produce an acceptable API document',
          completedAt: new Date(),
        },
      });

      throw new BadRequestException(
        repairResult.finalErrorMessage
        || 'Automatic repair could not produce an acceptable API document',
      );
    }

    await this.prisma.apiUploadJob.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        currentAttemptNo: repairResult.attempts.length,
        finalDecision: 'accepted',
        acceptedContent: repairResult.accepted.content,
        acceptedContentHash: this.computeHash(repairResult.accepted.content),
        acceptedEndpointCount: repairResult.accepted.endpointCount,
        acceptedWorkflowCount: repairResult.accepted.workflowCount,
        acceptedValidationScore: repairResult.accepted.validationScore,
        finalErrorType: null,
        finalErrorMessage: null,
      },
    });

    try {
      const uploadResult = await this.apiUploadService.uploadAndProcess({
        tenantId: job.tenantId,
        connectorId: job.connectorId,
        docType: repairResult.accepted.effectiveDocType,
        docContent: repairResult.accepted.content,
        oaUrl: job.oaUrl || '',
        authConfig: job.authConfig,
        autoValidate: job.autoValidate,
        autoGenerateMcp: job.autoGenerateMcp,
      });

      await this.prisma.apiUploadJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          uploadResult: uploadResult as any,
          completedAt: new Date(),
        },
      });

      return {
        ...uploadResult,
        jobId: job.id,
        repair: {
          attempted: repairResult.attempts.length > 0,
          accepted: true,
          attemptCount: repairResult.attempts.length,
          acceptedAttemptNo: repairResult.attempts.length,
          acceptedDocType: repairResult.accepted.effectiveDocType,
          validationScore: repairResult.accepted.validationScore,
        },
      };
    } catch (error) {
      await this.markJobFailure(job.id, error, {
        finalDecision: 'accepted',
        finalErrorType: 'upload_processing_failed',
      });
      throw error;
    }
  }

  private async persistAttempts(
    jobId: string,
    initialContent: string,
    attempts: ApiUploadRepairAttemptResult[],
    hasAcceptedAttempt: boolean,
  ) {
    let currentInput = initialContent;

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const isAcceptedAttempt = hasAcceptedAttempt && index === attempts.length - 1;
      await this.prisma.apiUploadAttempt.create({
        data: {
          jobId,
          attemptNo: index + 1,
          stage: attempt.stage,
          strategy: attempt.strategy,
          inputContent: currentInput,
          inputHash: this.computeHash(currentInput),
          outputContent: attempt.content,
          outputHash: this.computeHash(attempt.content),
          diagnostics: attempt.evaluation.diagnostics as any,
          repairActions: attempt.actions as any,
          parseSuccess: attempt.evaluation.parseSuccess,
          endpointCount: attempt.evaluation.endpointCount,
          workflowCount: attempt.evaluation.workflowCount,
          validationScore: attempt.evaluation.validationScore,
          decision: isAcceptedAttempt ? 'accepted' : 'rejected',
          errorType: attempt.evaluation.parseSuccess
            ? null
            : 'parse_failed',
          errorMessage: attempt.evaluation.parseError || null,
        },
      });
      currentInput = attempt.content;
    }
  }

  private async markJobFailure(
    jobId: string,
    error: unknown,
    overrides?: {
      finalDecision?: string;
      finalErrorType?: string;
    },
  ) {
    const message = error instanceof Error ? error.message : 'Unknown upload error';
    this.logger.error(`API upload job ${jobId} failed: ${message}`);

    await this.prisma.apiUploadJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finalDecision: overrides?.finalDecision || 'rejected',
        finalErrorType: overrides?.finalErrorType || 'upload_failed',
        finalErrorMessage: message,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
  }

  private async ensureJobFailureRecorded(
    jobId: string,
    error: unknown,
    overrides?: {
      finalDecision?: string;
      finalErrorType?: string;
    },
  ) {
    const job = await this.prisma.apiUploadJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    }).catch(() => null);

    if (job?.status === 'FAILED' || job?.status === 'SUCCEEDED') {
      return;
    }

    await this.markJobFailure(jobId, error, overrides);
  }

  private sanitizeJob(job: any, options: ApiUploadJobViewOptions) {
    const {
      sourceContent,
      acceptedContent,
      authConfig,
      attempts,
      ...rest
    } = job;

    return {
      ...rest,
      authConfig: this.sanitizeAuthConfig(authConfig),
      sourceContent: options.includeContent ? sourceContent : undefined,
      acceptedContent: options.includeContent ? acceptedContent : undefined,
      attempts: attempts?.map((attempt: any) => this.sanitizeAttempt(attempt, options)) || [],
    };
  }

  private sanitizeAttempt(attempt: any, options: ApiUploadJobViewOptions) {
    const { inputContent, outputContent, ...rest } = attempt;

    return {
      ...rest,
      inputContent: options.includeContent ? inputContent : undefined,
      outputContent: options.includeContent ? outputContent : undefined,
    };
  }

  private sanitizeAuthConfig(authConfig: Record<string, any> | null | undefined) {
    if (!authConfig || typeof authConfig !== 'object' || Array.isArray(authConfig)) {
      return authConfig || null;
    }

    const sanitized = Object.fromEntries(
      Object.entries(authConfig).filter(([key]) => !API_UPLOAD_SENSITIVE_AUTH_KEYS.has(key)),
    );

    const platformConfig = authConfig.platformConfig;
    if (platformConfig && typeof platformConfig === 'object' && !Array.isArray(platformConfig)) {
      sanitized.platformConfig = Object.fromEntries(
        Object.entries(platformConfig as Record<string, any>).filter(
          ([key]) => !API_UPLOAD_SENSITIVE_AUTH_KEYS.has(key),
        ),
      );
    }

    return sanitized;
  }

  private computeHash(content: string) {
    return createHash('sha256').update(content).digest('hex');
  }
}
