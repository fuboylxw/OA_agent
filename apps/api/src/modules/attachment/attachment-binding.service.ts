import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import type { AttachmentRef } from './attachment.types';
import { collectAttachmentRefs, normalizeAttachmentRef } from './attachment.utils';

@Injectable()
export class AttachmentBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async bindSessionAttachments(input: {
    tenantId: string;
    userId: string;
    sessionId: string;
    attachments: AttachmentRef[];
  }) {
    for (const attachment of input.attachments) {
      const normalized = normalizeAttachmentRef(attachment);
      if (!normalized) {
        continue;
      }

      const existing = await this.prisma.attachmentBinding.findFirst({
        where: {
          tenantId: input.tenantId,
          assetId: normalized.attachmentId,
          sessionId: input.sessionId,
          fieldKey: normalized.fieldKey || null,
          isActive: true,
        },
      });

      if (existing) {
        continue;
      }

      await this.prisma.attachmentBinding.create({
        data: {
          tenantId: input.tenantId,
          assetId: normalized.attachmentId,
          sessionId: input.sessionId,
          fieldKey: normalized.fieldKey || null,
          bindScope: normalized.bindScope || 'field',
          phase: 'draft',
          createdBy: input.userId,
        },
      });
    }
  }

  async syncDraftBindings(input: {
    tenantId: string;
    userId: string;
    sessionId?: string | null;
    draftId: string;
    formData: Record<string, any>;
  }) {
    await this.prisma.attachmentBinding.updateMany({
      where: {
        tenantId: input.tenantId,
        draftId: input.draftId,
        isActive: true,
      },
      data: { isActive: false },
    });

    const refs = collectAttachmentRefs(input.formData);
    for (const entry of refs) {
      await this.prisma.attachmentBinding.create({
        data: {
          tenantId: input.tenantId,
          assetId: entry.ref.attachmentId,
          sessionId: input.sessionId || null,
          draftId: input.draftId,
          fieldKey: entry.fieldKey,
          bindScope: entry.bindScope,
          phase: 'draft',
          createdBy: input.userId,
        },
      });
    }
  }

  async syncSubmissionBindings(input: {
    tenantId: string;
    userId: string;
    draftId?: string | null;
    submissionId: string;
    formData: Record<string, any>;
    phase?: 'submit' | 'supplement' | 'rework' | 'history';
  }) {
    await this.prisma.attachmentBinding.updateMany({
      where: {
        tenantId: input.tenantId,
        submissionId: input.submissionId,
        isActive: true,
      },
      data: { isActive: false },
    });

    const refs = collectAttachmentRefs(input.formData);
    for (const entry of refs) {
      const latestVersion = await this.prisma.attachmentBinding.aggregate({
        where: {
          tenantId: input.tenantId,
          submissionId: input.submissionId,
          assetId: entry.ref.attachmentId,
          fieldKey: entry.fieldKey,
        },
        _max: {
          versionNo: true,
        },
      });

      await this.prisma.attachmentBinding.create({
        data: {
          tenantId: input.tenantId,
          assetId: entry.ref.attachmentId,
          draftId: input.draftId || null,
          submissionId: input.submissionId,
          fieldKey: entry.fieldKey,
          bindScope: entry.bindScope,
          phase: input.phase || 'submit',
          versionNo: (latestVersion._max.versionNo || 0) + 1,
          createdBy: input.userId,
        },
      });
    }
  }

  async canDeleteAttachment(tenantId: string, attachmentId: string, userId: string) {
    const asset = await this.prisma.attachmentAsset.findUnique({
      where: { id: attachmentId },
      select: {
        tenantId: true,
        uploaderId: true,
        status: true,
      },
    });

    if (!asset || asset.tenantId !== tenantId || asset.status === 'deleted') {
      return { allowed: false, reason: '附件不存在或已删除' };
    }

    if (asset.uploaderId !== userId) {
      return { allowed: false, reason: '仅允许上传者删除附件' };
    }

    const submissionBinding = await this.prisma.attachmentBinding.findFirst({
      where: {
        tenantId,
        assetId: attachmentId,
        submissionId: { not: null },
        isActive: true,
      },
    });

    if (submissionBinding) {
      return { allowed: false, reason: '已进入提交记录的附件不可删除' };
    }

    return { allowed: true, reason: '' };
  }
}
