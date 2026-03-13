import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { canPreviewAttachment, getAttachmentPreviewStatus, normalizeExtension } from './attachment.utils';
import { basename, extname, join } from 'path';
import { spawn } from 'child_process';

@Injectable()
export class AttachmentPreviewService {
  private readonly logger = new Logger(AttachmentPreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: AttachmentStorageService,
  ) {}

  getInitialPreviewStatus(mimeType?: string | null, extension?: string | null) {
    return getAttachmentPreviewStatus(mimeType, extension);
  }

  canPreview(mimeType?: string | null, extension?: string | null, previewStatus?: string | null) {
    return canPreviewAttachment(mimeType, extension, previewStatus as any);
  }

  async generatePreview(assetId: string) {
    const asset = await this.prisma.attachmentAsset.findUnique({
      where: { id: assetId },
    });

    if (!asset || asset.status === 'deleted') {
      return;
    }

    const extension = normalizeExtension(asset.extension || extname(asset.originalName));
    const previewStatus = getAttachmentPreviewStatus(asset.mimeType, extension);

    if (previewStatus === 'ready' || previewStatus === 'unsupported') {
      await this.prisma.attachmentAsset.update({
        where: { id: asset.id },
        data: {
          previewStatus,
          previewError: null,
        },
      });
      return;
    }

    await this.prisma.attachmentAsset.update({
      where: { id: asset.id },
      data: {
        previewStatus: 'pending',
        previewError: null,
      },
    });

    const sourcePath = this.storageService.resolveStoragePath(asset.storageKey);
    const tempDir = await this.storageService.createTempPreviewDir(asset.id);

    try {
      const outputPdfPath = await this.convertOfficeToPdf(sourcePath, tempDir);
      const previewKey = await this.storageService.savePreviewFile(asset.id, outputPdfPath);

      await this.prisma.attachmentAsset.update({
        where: { id: asset.id },
        data: {
          previewStatus: 'ready',
          previewKey,
          previewError: null,
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to generate preview for ${asset.id}: ${error.message}`);
      await this.prisma.attachmentAsset.update({
        where: { id: asset.id },
        data: {
          previewStatus: 'failed',
          previewError: error.message,
        },
      });
    } finally {
      await this.storageService.removeDir(tempDir);
    }
  }

  private async convertOfficeToPdf(sourcePath: string, outputDir: string) {
    const command = process.env.LIBREOFFICE_BIN || 'soffice';

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', outputDir,
        sourcePath,
      ], {
        stdio: 'ignore',
      });

      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`LibreOffice exited with code ${code}`));
      });
    });

    const fileName = `${basename(sourcePath).replace(extname(sourcePath), '') || 'preview'}.pdf`;
    return join(outputDir, fileName);
  }
}
