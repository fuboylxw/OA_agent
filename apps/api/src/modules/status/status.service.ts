import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdapterFactory } from '@uniflow/oa-adapters';

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async queryStatus(submissionId: string, traceId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        statusRecords: {
          orderBy: { queriedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // If we have an OA submission ID, query the OA system
    let oaStatus = null;
    if (submission.oaSubmissionId) {
      const adapter = AdapterFactory.createMockAdapter('openapi', []);
      const result = await adapter.queryStatus(submission.oaSubmissionId);
      oaStatus = result;

      // Record status query
      await this.prisma.submissionStatus.create({
        data: {
          submissionId: submission.id,
          status: result.status,
          statusDetail: result as any,
        },
      });
    }

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId: submission.userId,
      action: 'query_status',
      resource: submissionId,
      result: 'success',
      details: { oaStatus },
    });

    return {
      submissionId: submission.id,
      status: submission.status,
      oaSubmissionId: submission.oaSubmissionId,
      oaStatus,
      timeline: this.buildTimeline(submission),
      statusRecords: submission.statusRecords,
    };
  }

  async listMySubmissions(tenantId: string, userId: string) {
    const submissions = await this.prisma.submission.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return submissions.map(s => ({
      id: s.id,
      templateId: s.templateId,
      status: s.status,
      oaSubmissionId: s.oaSubmissionId,
      createdAt: s.createdAt,
      submittedAt: s.submittedAt,
    }));
  }

  async getTimeline(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        statusRecords: {
          orderBy: { queriedAt: 'asc' },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    return this.buildTimeline(submission);
  }

  private buildTimeline(submission: any) {
    const timeline: Array<{
      timestamp: Date;
      status: string;
      description: string;
    }> = [];

    // Created
    timeline.push({
      timestamp: submission.createdAt,
      status: 'created',
      description: '申请已创建',
    });

    // Submitted
    if (submission.submittedAt) {
      timeline.push({
        timestamp: submission.submittedAt,
        status: 'submitted',
        description: '已提交至OA系统',
      });
    }

    // Status records
    if (submission.statusRecords) {
      for (const record of submission.statusRecords) {
        timeline.push({
          timestamp: record.queriedAt,
          status: record.status,
          description: `状态更新: ${record.status}`,
        });
      }
    }

    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return timeline;
  }
}
