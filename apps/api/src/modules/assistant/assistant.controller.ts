import { Controller, Post, Body, Get, Param, Query, Delete, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
@Controller('v1/assistant')
export class AssistantController {
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
      });
    } catch (error: any) {
      console.error('[AssistantController] chat error:', error.message);

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
      console.error('[AssistantController] listSessions error:', error.message);
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
      console.error('[AssistantController] getMessages error:', error.message);
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
      console.error('[AssistantController] deleteSession error:', error.message);
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
      console.error('[AssistantController] resetSession error:', error.message);
      throw new HttpException(
        error.message || 'Failed to reset session',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
