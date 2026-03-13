import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentPreviewService } from './attachment-preview.service';
import { AttachmentBindingService } from './attachment-binding.service';
import { AttachmentPreviewProcessor } from './attachment-preview.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'attachment-preview' })],
  controllers: [AttachmentController],
  providers: [
    AttachmentService,
    AttachmentStorageService,
    AttachmentPreviewService,
    AttachmentBindingService,
    AttachmentPreviewProcessor,
  ],
  exports: [
    AttachmentService,
    AttachmentBindingService,
  ],
})
export class AttachmentModule {}
