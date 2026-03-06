import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DocumentParserService } from './document-parser.service';

class ParseDocumentDto {
  documentType: string;
  documentUrl?: string;
  documentContent?: string;
  parseOptions?: {
    autoPublish?: boolean;
    extractBusinessLogic?: boolean;
    generateFieldMapping?: boolean;
    confidenceThreshold?: number;
    filterNonBusinessEndpoints?: boolean;
    includeUserLinks?: boolean;
  };
}

class ConfirmParseDto {
  parseJobId: string;
  action: 'publish' | 'reject' | 'modify';
  modifications?: Array<{
    processCode: string;
    fieldCode?: string;
    changes?: any;
  }>;
  comment?: string;
}

class ReparseDto {
  parseJobId: string;
  parseOptions?: {
    confidenceThreshold?: number;
    extractBusinessLogic?: boolean;
  };
  focusEndpoints?: string[];
}

@ApiTags('bootstrap')
@Controller('bootstrap/jobs')
export class DocumentParserController {
  constructor(private readonly parserService: DocumentParserService) {}

  @Post(':id/parse-document')
  @ApiOperation({ summary: '上传并解析API文档' })
  @ApiResponse({ status: 200, description: '解析任务已创建' })
  async parseDocument(
    @Param('id') bootstrapJobId: string,
    @Body() dto: ParseDocumentDto,
  ) {
    // 从 bootstrapJob 获取 tenantId
    const bootstrapJob = await this.parserService['prisma'].bootstrapJob.findUnique({
      where: { id: bootstrapJobId },
    });

    if (!bootstrapJob) {
      throw new Error('Bootstrap job not found');
    }

    const parseJob = await this.parserService.createParseJob({
      tenantId: bootstrapJob.tenantId,
      bootstrapJobId,
      ...dto,
    });

    return {
      code: 0,
      message: '解析任务已创建',
      data: {
        parseJobId: parseJob.id,
        bootstrapJobId: parseJob.bootstrapJobId,
        status: parseJob.status,
        estimatedTime: 120,
        createdAt: parseJob.createdAt,
      },
    };
  }

  @Get(':id/parse-status')
  @ApiOperation({ summary: '查询解析状态' })
  async getParseStatus(
    @Param('id') bootstrapJobId: string,
    @Query('parseJobId') parseJobId?: string,
  ) {
    const status = await this.parserService.getParseStatus(
      bootstrapJobId,
      parseJobId,
    );

    return {
      code: 0,
      data: status,
    };
  }

  @Get(':id/parse-result')
  @ApiOperation({ summary: '获取解析结果详情' })
  async getParseResult(@Param('id') bootstrapJobId: string) {
    const result = await this.parserService.getParseResult(bootstrapJobId);

    return {
      code: 0,
      data: result,
    };
  }

  @Post(':id/confirm-parse')
  @ApiOperation({ summary: '确认并发布解析结果' })
  async confirmParse(
    @Param('id') bootstrapJobId: string,
    @Body() dto: ConfirmParseDto,
  ) {
    if (dto.action === 'reject') {
      return {
        code: 0,
        message: '解析结果已拒绝',
        data: { parseJobId: dto.parseJobId },
      };
    }

    const result = await this.parserService.confirmAndPublish(
      bootstrapJobId,
      dto.parseJobId,
      dto.modifications,
      dto.comment,
    );

    return {
      code: 0,
      message: '解析结果已发布到流程库',
      data: result,
    };
  }

  @Post(':id/reparse')
  @ApiOperation({ summary: '重新解析' })
  async reparse(
    @Param('id') bootstrapJobId: string,
    @Body() dto: ReparseDto,
  ) {
    const parseJob = await this.parserService.reparse(
      bootstrapJobId,
      dto.parseJobId,
      dto.parseOptions,
      dto.focusEndpoints,
    );

    return {
      code: 0,
      message: '重新解析任务已创建',
      data: {
        parseJobId: parseJob.id,
        status: parseJob.status,
      },
    };
  }
}