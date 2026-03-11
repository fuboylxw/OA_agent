import { Controller, Post, Body, Get, Param, Query, Delete, HttpException, HttpStatus, Logger, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AssistantService } from './assistant.service';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// 上传目录
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'chat-attachments');
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

class ChatAttachment {
  @ApiProperty({ description: '文件ID' })
  fileId: string;

  @ApiProperty({ description: '原始文件名' })
  fileName: string;

  @ApiProperty({ description: '文件大小（字节）' })
  fileSize: number;

  @ApiProperty({ description: '文件MIME类型' })
  mimeType: string;

  @ApiProperty({ description: '文件存储路径' })
  filePath: string;
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

  @ApiProperty({ required: false, description: '缺失的字段' })
  missingFields?: Array<{ key: string; label: string; question: string }>;

  @ApiProperty({ required: false, description: '流程状态' })
  processStatus?: string;
}

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistantService: AssistantService) {}

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
  async chat(@Body() dto: ChatDto) {
    try {
      const tenantId = dto.tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant';
      // Use admin user as default if userId is not provided or invalid
      const userId = dto.userId || 'e228391e-81b2-401c-8381-995be98b3866';

      return await this.assistantService.chat({
        tenantId,
        userId,
        sessionId: dto.sessionId,
        message: dto.message,
        attachments: dto.attachments,
      });
    } catch (error: any) {
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
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
  ) {
    try {
      const resolvedTenantId = tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant';
      const resolvedUserId = userId || 'e228391e-81b2-401c-8381-995be98b3866';

      return await this.assistantService.listSessions(resolvedTenantId, resolvedUserId);
    } catch (error: any) {
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
  async getMessages(@Param('sessionId') sessionId: string) {
    try {
      return await this.assistantService.getMessages(sessionId);
    } catch (error: any) {
      this.logger.error(`getMessages error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to get messages',
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
  async deleteSession(@Param('sessionId') sessionId: string) {
    try {
      await this.assistantService.deleteSession(sessionId);
      return { success: true, message: '会话已删除' };
    } catch (error: any) {
      this.logger.error(`deleteSession error: ${error.message}`);
      throw new HttpException(
        error.message || 'Failed to delete session',
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
  async resetSession(@Param('sessionId') sessionId: string) {
    try {
      await this.assistantService.resetSession(sessionId);
      return { success: true, message: '会话上下文已重置' };
    } catch (error: any) {
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
    description: '上传文件作为聊天附件（如报销发票、请假证明等），最多5个文件，单文件最大10MB'
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 5, {
    storage: diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar)$/i;
      if (allowed.test(extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new HttpException('不支持的文件类型', HttpStatus.BAD_REQUEST), false);
      }
    },
  }))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new HttpException('请选择要上传的文件', HttpStatus.BAD_REQUEST);
    }

    return files.map(file => ({
      fileId: file.filename.replace(extname(file.filename), ''),
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      filePath: file.path,
    }));
  }
}
