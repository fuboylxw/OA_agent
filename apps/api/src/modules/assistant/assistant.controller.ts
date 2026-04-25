import { Controller, Post, Body, Get, Param, Query, Delete, HttpException, HttpStatus, Logger, UseInterceptors, UploadedFiles, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AssistantService } from './assistant.service';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AttachmentService } from '../attachment/attachment.service';
import { attachmentUploadInterceptorOptions } from '../attachment/attachment-upload.config';
import { RequestAuthService } from '../common/request-auth.service';

class ChatAttachment {
  @ApiProperty({ description: '附件ID' })
  attachmentId: string;

  @ApiProperty({ description: '文件ID' })
  fileId: string;

  @ApiProperty({ description: '原始文件名' })
  fileName: string;

  @ApiProperty({ description: '文件大小（字节）' })
  fileSize: number;

  @ApiProperty({ description: '文件MIME类型' })
  mimeType: string;

  @ApiProperty({ required: false, description: '绑定字段键' })
  fieldKey?: string;

  @ApiProperty({ required: false, description: '绑定范围', enum: ['field', 'general'] })
  bindScope?: 'field' | 'general';

  @ApiProperty({ required: false, description: '预览状态' })
  previewStatus?: string;

  @ApiProperty({ required: false, description: '是否可预览' })
  canPreview?: boolean;

  @ApiProperty({ required: false, description: '预览链接' })
  previewUrl?: string;

  @ApiProperty({ required: false, description: '下载链接' })
  downloadUrl?: string;
}

class MissingFieldDto {
  @ApiProperty({ description: '字段键' })
  key: string;

  @ApiProperty({ description: '字段标签' })
  label: string;

  @ApiProperty({ description: '补充提示语' })
  question: string;

  @ApiProperty({ required: false, description: '字段类型' })
  type?: string;

  @ApiProperty({ required: false, description: '字段解释/填写说明' })
  description?: string;

  @ApiProperty({ required: false, description: '字段示例值' })
  example?: string;

  @ApiProperty({ required: false, description: '是否支持多份上传/多值输入' })
  multiple?: boolean;

  @ApiProperty({ required: false, description: '字段可选项' })
  options?: Array<{ label: string; value: string }>;
}

class ActionButtonDto {
  @ApiProperty({ description: '按钮文案' })
  label: string;

  @ApiProperty({ description: '动作标识' })
  action: string;

  @ApiProperty({ description: '按钮类型', enum: ['primary', 'default', 'danger'] })
  type: 'primary' | 'default' | 'danger';
}

class ProcessCardFieldDto {
  @ApiProperty({ description: '字段键' })
  key: string;

  @ApiProperty({ description: '字段标签' })
  label: string;

  @ApiProperty({ required: false, description: '原始值' })
  value?: any;

  @ApiProperty({ required: false, description: '展示值' })
  displayValue?: any;

  @ApiProperty({ description: '字段类型' })
  type: string;

  @ApiProperty({ required: false, description: '是否必填' })
  required?: boolean;

  @ApiProperty({ required: false, description: '字段解释/填写说明' })
  description?: string;

  @ApiProperty({ required: false, description: '字段示例值' })
  example?: string;

  @ApiProperty({ required: false, description: '是否支持多文件/多值' })
  multiple?: boolean;

  @ApiProperty({ required: false, description: '字段可选项' })
  options?: Array<{ label: string; value: string }>;

  @ApiProperty({ required: false, description: '字段来源', enum: ['user', 'derived', 'prefill'] })
  origin?: 'user' | 'derived' | 'prefill';

  @ApiProperty({ required: false, description: '来源标签' })
  tagLabel?: string;

  @ApiProperty({ required: false, description: '来源标签色调', enum: ['sky', 'amber', 'slate'] })
  tagTone?: 'sky' | 'amber' | 'slate';

  @ApiProperty({ required: false, description: '字段补充说明' })
  hint?: string;
}

class ProcessCardDto {
  @ApiProperty({ description: '流程实例ID' })
  processInstanceId: string;

  @ApiProperty({ description: '流程编码' })
  processCode: string;

  @ApiProperty({ description: '流程名称' })
  processName: string;

  @ApiProperty({ required: false, description: '流程分类' })
  processCategory?: string | null;

  @ApiProperty({ required: false, description: '流程状态' })
  processStatus?: string;

  @ApiProperty({
    description: '流程阶段',
    enum: ['collecting', 'confirming', 'executing', 'draft', 'submitted', 'rework', 'completed', 'failed', 'cancelled'],
  })
  stage: 'collecting' | 'confirming' | 'executing' | 'draft' | 'submitted' | 'rework' | 'completed' | 'failed' | 'cancelled';

  @ApiProperty({ description: '卡片操作状态', enum: ['available', 'readonly'] })
  actionState: 'available' | 'readonly';

  @ApiProperty({ description: '是否可继续办理' })
  canContinue: boolean;

  @ApiProperty({ description: '状态文案' })
  statusText: string;

  @ApiProperty({ required: false, description: '确认摘要' })
  summary?: string;

  @ApiProperty({ required: false, description: '表单原始数据' })
  formData?: Record<string, any>;

  @ApiProperty({ type: [ProcessCardFieldDto], description: '结构化表单字段' })
  fields: ProcessCardFieldDto[];

  @ApiProperty({ required: false, type: [MissingFieldDto], description: '待补充字段' })
  missingFields?: MissingFieldDto[];

  @ApiProperty({ required: false, type: [ActionButtonDto], description: '可用操作按钮' })
  actionButtons?: ActionButtonDto[];

  @ApiProperty({ required: false, description: '是否需要附件' })
  needsAttachment?: boolean;

  @ApiProperty({ required: false, description: '草稿ID' })
  draftId?: string;

  @ApiProperty({ required: false, description: '提交记录ID' })
  submissionId?: string;

  @ApiProperty({ required: false, description: 'OA单号' })
  oaSubmissionId?: string | null;

  @ApiProperty({ required: false, description: '返工提示类型', enum: ['supplement', 'modify', 'unknown'] })
  reworkHint?: 'supplement' | 'modify' | 'unknown';

  @ApiProperty({ required: false, description: '驳回原因' })
  reworkReason?: string | null;

  @ApiProperty({ description: '更新时间' })
  updatedAt: string;
}

class SessionStateDto {
  @ApiProperty({ description: '是否存在进行中的流程' })
  hasActiveProcess: boolean;

  @ApiProperty({ required: false, description: '流程实例ID' })
  processInstanceId?: string;

  @ApiProperty({ required: false, description: '流程编码' })
  processCode?: string;

  @ApiProperty({ required: false, description: '流程名称' })
  processName?: string;

  @ApiProperty({ required: false, description: '流程分类' })
  processCategory?: string | null;

  @ApiProperty({ required: false, description: '流程状态' })
  processStatus?: string;

  @ApiProperty({
    required: false,
    description: '流程阶段',
    enum: ['collecting', 'confirming', 'executing', 'draft', 'submitted', 'rework', 'completed', 'failed', 'cancelled'],
  })
  stage?: 'collecting' | 'confirming' | 'executing' | 'draft' | 'submitted' | 'rework' | 'completed' | 'failed' | 'cancelled';

  @ApiProperty({ required: false, description: '返工提示类型', enum: ['supplement', 'modify', 'unknown'] })
  reworkHint?: 'supplement' | 'modify' | 'unknown';

  @ApiProperty({ required: false, description: '驳回原因' })
  reworkReason?: string | null;

  @ApiProperty({ required: false, description: '是否终态' })
  isTerminal?: boolean;

  @ApiProperty({ required: false, type: ProcessCardDto, description: '当前激活流程卡片' })
  activeProcessCard?: ProcessCardDto | null;
}

class ChatDto {
  @ApiProperty({ required: false, description: '会话ID，不提供则创建新会话' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({ description: '用户消息内容' })
  @IsString()
  message: string;

  @ApiProperty({ required: false, description: '用户ID，不提供则使用默认用户' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ required: false, description: '租户ID，不提供则使用默认租户' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty({ required: false, description: '附件列表' })
  @IsOptional()
  @IsArray()
  attachments?: ChatAttachment[];

  @ApiProperty({ required: false, description: '前端已选中的流程模板 ID，用于精确进入某个流程版本' })
  @IsOptional()
  @IsString()
  requestedTemplateId?: string;

  @ApiProperty({ required: false, description: '前端已选中的连接器 ID，用于避免同码流程串到其他连接器' })
  @IsOptional()
  @IsString()
  requestedConnectorId?: string;
}

class ChatResponseDto {
  @ApiProperty({ description: '会话ID' })
  sessionId: string;

  @ApiProperty({ description: '助手回复消息' })
  message: string;

  @ApiProperty({ required: false, description: '识别的意图' })
  intent?: string;

  @ApiProperty({ required: false, description: '草稿ID' })
  draftId?: string;

  @ApiProperty({ description: '是否需要用户输入' })
  needsInput: boolean;

  @ApiProperty({ required: false, description: '建议的操作' })
  suggestedActions?: string[];

  @ApiProperty({ required: false, description: '表单数据' })
  formData?: Record<string, any>;

  @ApiProperty({ required: false, type: [MissingFieldDto], description: '缺失的字段' })
  missingFields?: MissingFieldDto[];

  @ApiProperty({ required: false, description: '流程状态' })
  processStatus?: string;

  @ApiProperty({ required: false, type: [ActionButtonDto], description: '卡片可用按钮' })
  actionButtons?: ActionButtonDto[];

  @ApiProperty({ required: false, description: '是否需要上传附件' })
  needsAttachment?: boolean;

  @ApiProperty({ required: false, type: ProcessCardDto, description: '结构化流程卡片' })
  processCard?: ProcessCardDto;

  @ApiProperty({ required: false, type: SessionStateDto, description: '会话流程态' })
  sessionState?: SessionStateDto;
}

class UpdatePendingFormFieldDto {
  @ApiProperty({ description: '字段键' })
  @IsString()
  fieldKey: string;

  @ApiProperty({ description: '用户直接输入的新值' })
  @IsString()
  value: string;
}

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly attachmentService: AttachmentService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('chat')
  @ApiOperation({
    summary: '对话工作台 - 发送消息给智能助手',
    description: '支持自然语言交互，自动识别意图并处理OA申请流程'
  })
  @ApiResponse({
    status: 200,
    description: '成功返回助手回复',
    type: ChatResponseDto
  })
  @ApiResponse({
    status: 400,
    description: '请求参数错误'
  })
  @ApiResponse({
    status: 500,
    description: '服务器内部错误'
  })
  async chat(@Req() req: Request, @Body() dto: ChatDto) {
    try {
      const auth = await this.requestAuth.resolveUser(req, {
        tenantId: dto.tenantId,
        userId: dto.userId,
        allowUserFallback: true,
      });

      return await this.assistantService.chat({
        tenantId: auth.tenantId,
        userId: auth.userId || dto.userId?.trim() || '',
        sessionId: dto.sessionId,
        message: dto.message,
        attachments: dto.attachments,
        requestedTemplateId: dto.requestedTemplateId,
        requestedConnectorId: dto.requestedConnectorId,
        identityType: auth.identityType,
        roles: auth.roles,
      });
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Chat error: ${error.message}`);

      // Handle specific errors
      if (error.message?.includes('User not found')) {
        throw new HttpException(
          `Invalid userId: ${dto.userId}. Please provide a valid user ID.`,
          HttpStatus.BAD_REQUEST
        );
      }

      if (error.message?.includes('Tenant not found')) {
        throw new HttpException(
          `Invalid tenantId: ${dto.tenantId}. Please provide a valid tenant ID.`,
          HttpStatus.BAD_REQUEST
        );
      }

      throw new HttpException(
        error.message || 'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('sessions')
  @ApiOperation({
    summary: '获取会话列表',
    description: '获取指定用户的所有会话记录'
  })
  @ApiResponse({
    status: 200,
    description: '成功返回会话列表'
  })
  async listSessions(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, {
        tenantId,
        userId,
        requireUser: true,
      });

      return await this.assistantService.listSessions(auth.tenantId, auth.userId!);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`listSessions error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to list sessions',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('sessions/:sessionId/messages')
  @ApiOperation({
    summary: '获取会话消息',
    description: '获取指定会话的所有消息记录'
  })
  @ApiResponse({
    status: 200,
    description: '成功返回消息列表'
  })
  async getMessages(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
      return await this.assistantService.getMessages(sessionId, auth.tenantId, auth.userId!);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`getMessages error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to get messages',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('sessions/:sessionId/form')
  @ApiOperation({
    summary: '更新当前待确认表单中的单个字段',
    description: '用于确认页点击字段后直接键盘修改，修改后返回最新会话消息与流程卡片'
  })
  async updatePendingFormField(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdatePendingFormFieldDto,
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
      return await this.assistantService.updatePendingFormField({
        sessionId,
        tenantId: auth.tenantId,
        userId: auth.userId!,
        fieldKey: dto.fieldKey,
        value: dto.value,
        identityType: auth.identityType,
        roles: auth.roles,
      });
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`updatePendingFormField error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to update pending form field',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete('sessions/:sessionId')
  @ApiOperation({
    summary: '删除会话',
    description: '删除指定会话及其所有消息'
  })
  @ApiResponse({
    status: 200,
    description: '成功删除会话'
  })
  async deleteSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Query('mode') mode: 'archive' | 'purge' | undefined,
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
      const result = await this.assistantService.deleteSession(
        sessionId,
        auth.tenantId,
        auth.userId!,
        mode === 'purge' ? 'purge' : 'archive',
      );
      return {
        success: true,
        mode: result.mode,
        restorable: result.restorable,
        archivedAt: result.archivedAt || null,
        message: result.mode === 'archive' ? '会话已从历史中移除' : '会话已永久删除',
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`deleteSession error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to delete session',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('sessions/restore')
  @ApiOperation({
    summary: '从业务记录恢复对话',
    description: '从我的申请记录恢复已移除的对话，优先恢复原会话，否则创建新的恢复会话'
  })
  async restoreSession(
    @Req() req: Request,
    @Body() body: { sessionId?: string; submissionId?: string; draftId?: string },
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
      return await this.assistantService.restoreSessionFromBusinessRecord({
        sessionId: body?.sessionId,
        submissionId: body?.submissionId,
        draftId: body?.draftId,
        tenantId: auth.tenantId,
        userId: auth.userId!,
      });
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`restoreSession error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to restore session',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('sessions/:sessionId/reset')
  @ApiOperation({
    summary: '重置会话上下文',
    description: '清除会话的流程上下文，保留消息历史'
  })
  @ApiResponse({
    status: 200,
    description: '成功重置会话'
  })
  async resetSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ) {
    try {
      const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
      await this.assistantService.resetSession(sessionId, auth.tenantId, auth.userId!);
      return { success: true, message: '会话上下文已重置' };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`resetSession error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to reset session',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('upload')
  @ApiOperation({
    summary: '上传聊天附件',
    description: '上传文件作为聊天附件或表单附件，返回 attachmentId 供草稿和提交链路使用'
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10, attachmentUploadInterceptorOptions))
  async uploadFiles(
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
      sessionId,
      fieldKey,
      bindScope,
      files,
    });
  }
}
