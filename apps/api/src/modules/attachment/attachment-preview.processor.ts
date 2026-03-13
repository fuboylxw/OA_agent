import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { AttachmentPreviewService } from './attachment-preview.service';

@Processor('attachment-preview')
@Injectable()
export class AttachmentPreviewProcessor {
  constructor(private readonly attachmentPreviewService: AttachmentPreviewService) {}

  @Process('generate')
  async handleGeneratePreview(job: Job<{ assetId: string }>) {
    await this.attachmentPreviewService.generatePreview(job.data.assetId);
  }
}
