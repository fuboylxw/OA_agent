import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { AttachmentBindingService } from './attachment-binding.service';
import { AttachmentPreviewService } from './attachment-preview.service';
import { AttachmentStorageService } from './attachment-storage.service';
import type { AttachmentBindScope, AttachmentPayloadItem, AttachmentRef } from './attachment.types';
import {
  collectAttachmentRefs,
  normalizeAttachmentFileName,
  normalizeAttachmentRef,
  omitAttachmentFields,
} from './attachment.utils';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: AttachmentStorageService,
    private readonly previewService: AttachmentPreviewService,
    private readonly bindingService: AttachmentBindingService,
    @InjectQueue('attachment-preview') private readonly previewQueue: Queue,
  ) {}

  async upload(input: {
    tenantId: string;
    userId: string;
    files: Express.Multer.File[];
    sessionId?: string;
    fieldKey?: string;
    bindScope?: AttachmentBindScope;
  }) {
    if (!input.files?.length) {
      throw new BadRequestException('请选择要上传的文件');
    }

    const uploaded: AttachmentRef[] = [];

    for (const file of input.files) {
      const assetId = uuidv4();
      const originalName = normalizeAttachmentFileName(file.originalname) || file.originalname || `${assetId}.bin`;
      const normalizedFile = {
        ...file,
        originalname: originalName,
      } as Express.Multer.File;
      const persisted = await this.storageService.persistUploadedFile(normalizedFile, assetId);
      const previewStatus = this.previewService.getInitialPreviewStatus(file.mimetype, persisted.extension);

      const asset = await this.prisma.attachmentAsset.create({
        data: {
          id: assetId,
          tenantId: input.tenantId,
          uploaderId: input.userId,
          storageType: this.storageService.getStorageType(),
          storageKey: persisted.storageKey,
          originalName,
          extension: persisted.extension,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size,
          sha256: persisted.sha256,
          previewStatus,
        },
      });

      const ref = this.buildAttachmentRef(asset, input.tenantId, input.userId, {
        fieldKey: input.fieldKey,
        bindScope: input.bindScope,
      });
      uploaded.push(ref);

      if (input.sessionId) {
        await this.bindingService.bindSessionAttachments({
          tenantId: input.tenantId,
          userId: input.userId,
          sessionId: input.sessionId,
          attachments: [ref],
        });
      }

      if (previewStatus === 'pending') {
        await this.previewQueue.add('generate', { assetId: asset.id });
      }
    }

    return uploaded;
  }

  async normalizeAttachmentRefs(
    tenantId: string,
    userId: string,
    attachments: AttachmentRef[] = [],
  ) {
    const refs: AttachmentRef[] = [];

    for (const item of attachments) {
      const ref = normalizeAttachmentRef(item);
      if (!ref) {
        continue;
      }

      const asset = await this.getAccessibleAsset(ref.attachmentId, tenantId, userId);
      refs.push(this.buildAttachmentRef(asset, tenantId, userId, {
        fieldKey: ref.fieldKey || null,
        bindScope: ref.bindScope || 'field',
      }));
    }

    return refs;
  }

  async getAccessibleAsset(attachmentId: string, tenantId: string, userId?: string) {
    const asset = await this.prisma.attachmentAsset.findFirst({
      where: {
        id: attachmentId,
        tenantId,
        status: 'uploaded',
      },
    });

    if (!asset) {
      throw new NotFoundException('附件不存在');
    }

    if (!userId || asset.uploaderId === userId) {
      return asset;
    }

    const visibleBinding = await this.prisma.attachmentBinding.findFirst({
      where: {
        tenantId,
        assetId: attachmentId,
        isActive: true,
        OR: [
          { session: { userId } },
          { draft: { userId } },
          { submission: { userId } },
        ],
      },
    });

    if (!visibleBinding) {
      throw new ForbiddenException('无权访问该附件');
    }

    return asset;
  }

  async getDownloadResource(attachmentId: string, tenantId: string, userId?: string) {
    const asset = await this.getAccessibleAsset(attachmentId, tenantId, userId);
    return {
      asset,
      stream: await this.storageService.createStream(asset.storageKey),
    };
  }

  async getPreviewResource(attachmentId: string, tenantId: string, userId?: string) {
    const asset = await this.getAccessibleAsset(attachmentId, tenantId, userId);
    const storageKey = asset.previewKey || asset.storageKey;

    if (!this.previewService.canPreview(asset.mimeType, asset.extension, asset.previewStatus)) {
      throw new BadRequestException('该附件当前不支持在线预览');
    }

    if (!(await this.storageService.exists(storageKey))) {
      throw new NotFoundException('预览文件不存在');
    }

    return {
      asset,
      storageKey,
      stream: await this.storageService.createStream(storageKey),
    };
  }

  async deleteAttachment(attachmentId: string, tenantId: string, userId: string) {
    const permission = await this.bindingService.canDeleteAttachment(tenantId, attachmentId, userId);
    if (!permission.allowed) {
      throw new BadRequestException(permission.reason);
    }

    const asset = await this.getAccessibleAsset(attachmentId, tenantId, userId);

    await this.prisma.attachmentBinding.updateMany({
      where: {
        tenantId,
        assetId: attachmentId,
        isActive: true,
      },
      data: { isActive: false },
    });

    await this.prisma.attachmentAsset.update({
      where: { id: attachmentId },
      data: { status: 'deleted' },
    });

    await this.storageService.deleteFile(asset.storageKey);
    await this.storageService.deleteFile(asset.previewKey);

    return { success: true };
  }

  async prepareSubmissionPayload(input: {
    tenantId: string;
    userId: string;
    formData: Record<string, any>;
    schema?: { fields?: Array<{ key: string; label?: string; type?: string; required?: boolean }> } | null;
  }) {
    this.assertRequiredAttachments(input.formData, input.schema);

    const refs = collectAttachmentRefs(input.formData);
    const attachments: AttachmentPayloadItem[] = [];

    for (const entry of refs) {
      const asset = await this.getAccessibleAsset(entry.ref.attachmentId, input.tenantId, input.userId);
      const exists = await this.storageService.exists(asset.storageKey);
      const originalName = normalizeAttachmentFileName(asset.originalName) || asset.originalName;
      if (!exists) {
        throw new BadRequestException(`附件文件不存在：${originalName}`);
      }

      attachments.push({
        filename: originalName,
        mimeType: asset.mimeType,
        content: await this.storageService.readBuffer(asset.storageKey),
        fieldKey: entry.fieldKey,
        bindScope: entry.bindScope,
      });
    }

    const sanitizedFormData = omitAttachmentFields(input.formData, input.schema);

    return {
      sanitizedFormData,
      adapterAttachments: attachments,
      mcpAttachments: attachments.map((item) => ({
        fileName: item.filename,
        filename: item.filename,
        mimeType: item.mimeType,
        content: item.content.toString('base64'),
        fieldKey: item.fieldKey || null,
        bindScope: item.bindScope,
      })),
    };
  }

  buildAttachmentRef(
    asset: {
      id: string;
      originalName: string;
      size: number;
      mimeType: string;
      extension?: string | null;
      previewStatus?: string | null;
    },
    tenantId: string,
    userId: string,
    overrides?: { fieldKey?: string | null; bindScope?: AttachmentBindScope | null },
  ): AttachmentRef {
    const previewStatus = (asset.previewStatus || this.previewService.getInitialPreviewStatus(
      asset.mimeType,
      asset.extension,
    )) as any;
    const apiBaseUrl = this.getApiBaseUrl();
    const originalName = normalizeAttachmentFileName(asset.originalName) || asset.originalName;

    return {
      attachmentId: asset.id,
      fileId: asset.id,
      fileName: originalName,
      fileSize: asset.size,
      mimeType: asset.mimeType,
      fieldKey: overrides?.fieldKey || null,
      bindScope: overrides?.bindScope || 'field',
      previewStatus,
      canPreview: this.previewService.canPreview(asset.mimeType, asset.extension, previewStatus),
      previewUrl: `${apiBaseUrl}/api/v1/attachments/${asset.id}/preview?tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}`,
      downloadUrl: `${apiBaseUrl}/api/v1/attachments/${asset.id}/download?tenantId=${encodeURIComponent(tenantId)}&userId=${encodeURIComponent(userId)}`,
    };
  }

  private assertRequiredAttachments(
    formData: Record<string, any>,
    schema?: { fields?: Array<{ key: string; label?: string; type?: string; required?: boolean }> } | null,
  ) {
    const missingRequiredFields = (schema?.fields || [])
      .filter((field) => (field.type || '').toLowerCase() === 'file' && field.required)
      .filter((field) => {
        const value = formData[field.key];
        return !Array.isArray(value) || value.filter((item) => normalizeAttachmentRef(item)).length === 0;
      });

    if (missingRequiredFields.length > 0) {
      throw new BadRequestException(
        `缺少必传附件：${missingRequiredFields.map((field) => field.label || field.key).join('、')}`,
      );
    }
  }

  private getApiBaseUrl() {
    const configured = process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL;
    if (configured) {
      return configured.replace(/\/+$/, '');
    }

    return '';
  }
}
