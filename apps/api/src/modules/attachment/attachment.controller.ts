import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AttachmentService } from './attachment.service';
import { attachmentUploadInterceptorOptions } from './attachment-upload.config';
import { RequestAuthService } from '../common/request-auth.service';
import { normalizeAttachmentFileName } from './attachment.utils';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly requestAuth: RequestAuthService,
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
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
    @Query('sessionId') sessionId: string | undefined,
    @Query('fieldKey') fieldKey: string | undefined,
    @Query('bindScope') bindScope: 'field' | 'general' | undefined,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });

    return this.attachmentService.upload({
      tenantId: auth.tenantId,
      userId: auth.userId!,
      files,
      sessionId,
      fieldKey,
      bindScope,
    });
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载附件' })
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    const { asset, stream } = await this.attachmentService.getDownloadResource(
      id,
      auth.tenantId,
      auth.userId,
    );

    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(normalizeAttachmentFileName(asset.originalName) || asset.originalName)}`,
    );
    stream.pipe(res);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '在线预览附件' })
  async preview(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    const { asset, storageKey, stream } = await this.attachmentService.getPreviewResource(
      id,
      auth.tenantId,
      auth.userId,
    );
    const isPreviewPdf = storageKey === asset.previewKey || asset.mimeType === 'application/pdf';
    res.setHeader('Content-Type', isPreviewPdf ? 'application/pdf' : asset.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    stream.pipe(res);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: '删除附件' })
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    return this.attachmentService.deleteAttachment(id, auth.tenantId, auth.userId!);
  }
}
