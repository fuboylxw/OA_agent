import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AttachmentService } from './attachment.service';
import { attachmentUploadInterceptorOptions } from './attachment-upload.config';
import { TenantUserResolverService } from '../common/tenant-user-resolver.service';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly tenantUserResolver: TenantUserResolverService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: '上传业务附件' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'tenantId', required: true })
  @ApiQuery({ name: 'userId', required: true })
  @ApiQuery({ name: 'sessionId', required: false })
  @ApiQuery({ name: 'fieldKey', required: false })
  @ApiQuery({ name: 'bindScope', required: false, enum: ['field', 'general'] })
  @ApiResponse({ status: 201, description: '上传成功' })
  @UseInterceptors(FilesInterceptor('files', 10, attachmentUploadInterceptorOptions))
  async upload(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
    @Query('sessionId') sessionId: string | undefined,
    @Query('fieldKey') fieldKey: string | undefined,
    @Query('bindScope') bindScope: 'field' | 'general' | undefined,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const resolvedUser = await this.tenantUserResolver.resolve({
      tenantId,
      userId,
      allowFallback: false,
    });

    return this.attachmentService.upload({
      tenantId,
      userId: resolvedUser.id,
      files,
      sessionId,
      fieldKey,
      bindScope,
    });
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载附件' })
  async download(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const { asset, stream } = await this.attachmentService.getDownloadResource(id, tenantId, userId);
    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    stream.pipe(res);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '在线预览附件' })
  async preview(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const { asset, storageKey, stream } = await this.attachmentService.getPreviewResource(id, tenantId, userId);
    const isPreviewPdf = storageKey === asset.previewKey || asset.mimeType === 'application/pdf';
    res.setHeader('Content-Type', isPreviewPdf ? 'application/pdf' : asset.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    stream.pipe(res);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: '删除附件' })
  async remove(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    return this.attachmentService.deleteAttachment(id, tenantId, userId);
  }
}
