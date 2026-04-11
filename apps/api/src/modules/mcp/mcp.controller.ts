import { Controller, Get, Post, Body, Param, Query, UseInterceptors, UploadedFile, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { MCPService } from './mcp.service';
import { MCPExecutorService } from './mcp-executor.service';
import { ApiUploadService } from './api-upload.service';
import { ApiUploadJobService } from './api-upload-job.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('MCP Tools')
@Controller('mcp')
export class MCPController {
  constructor(
    private readonly mcpService: MCPService,
    private readonly mcpExecutor: MCPExecutorService,
    private readonly apiUploadService: ApiUploadService,
    private readonly apiUploadJobService: ApiUploadJobService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get('tools')
  @ApiOperation({ summary: 'List MCP tools for a connector' })
  async listTools(
    @Req() req: Request,
    @Query('connectorId') connectorId: string,
    @Query('category') category?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.mcpService.listTools(auth.tenantId, connectorId, category);
  }

  @Get('tools/:toolName')
  @ApiOperation({ summary: 'Get MCP tool details' })
  async getTool(
    @Req() req: Request,
    @Param('toolName') toolName: string,
    @Query('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.mcpService.getTool(auth.tenantId, connectorId, toolName);
  }

  @Post('tools/:toolName/execute')
  @ApiOperation({ summary: 'Execute an MCP tool' })
  async executeTool(
    @Req() req: Request,
    @Param('toolName') toolName: string,
    @Body() body: { connectorId: string; params: Record<string, any> },
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.mcpExecutor.executeTool(
      toolName,
      body.params,
      body.connectorId,
      auth.tenantId,
    );
  }

  @Post('tools/:toolName/test')
  @ApiOperation({ summary: 'Test an MCP tool with sample data' })
  async testTool(
    @Req() req: Request,
    @Param('toolName') toolName: string,
    @Query('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const tool = await this.mcpService.getTool(auth.tenantId, connectorId, toolName);

    if (!tool.testInput) {
      return { error: 'No test input defined for this tool' };
    }

    return this.mcpExecutor.executeTool(
      toolName,
      tool.testInput as Record<string, any>,
      connectorId,
      auth.tenantId,
    );
  }

  @Post('upload-api')
  @ApiOperation({ summary: 'Upload API documentation and auto-generate MCP tools' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadApiFile(
    @Req() req: Request,
    @UploadedFile() file: any,
    @Body() body: {
      tenantId: string;
      connectorId: string;
      docType: 'openapi' | 'swagger' | 'postman' | 'custom';
      oaUrl: string;
      authConfig: string; // JSON string
      autoValidate?: string; // 'true' or 'false'
      autoGenerateMcp?: string; // 'true' or 'false'
    },
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId: body.tenantId,
      requireUser: true,
    });
    const docContent = file ? file.buffer.toString('utf-8') : '';
    const authConfig = JSON.parse(body.authConfig || '{}');

    return this.apiUploadJobService.uploadAndProcessWithRepair({
      tenantId: auth.tenantId,
      connectorId: body.connectorId,
      docType: body.docType,
      docContent,
      sourceName: file?.originalname,
      oaUrl: body.oaUrl,
      authConfig,
      autoValidate: body.autoValidate === 'true',
      autoGenerateMcp: body.autoGenerateMcp === 'true',
    });
  }

  @Post('upload-api-json')
  @ApiOperation({ summary: 'Upload API documentation (JSON body) and auto-generate MCP tools' })
  async uploadApiJson(
    @Req() req: Request,
    @Body() body: {
      tenantId: string;
      connectorId: string;
      docType: 'openapi' | 'swagger' | 'postman' | 'custom';
      docContent: string;
      oaUrl: string;
      authConfig: any;
      autoValidate?: boolean;
      autoGenerateMcp?: boolean;
    },
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId: body.tenantId,
      requireUser: true,
    });
    return this.apiUploadJobService.uploadAndProcessWithRepair({
      ...body,
      tenantId: auth.tenantId,
    });
  }

  @Post('upload-api-job')
  @ApiOperation({ summary: 'Create an API upload repair job and run it asynchronously' })
  async uploadApiJob(
    @Req() req: Request,
    @Body() body: {
      tenantId: string;
      connectorId: string;
      sourceName?: string;
      docType: 'openapi' | 'swagger' | 'postman' | 'custom';
      docContent: string;
      oaUrl: string;
      authConfig: any;
      autoValidate?: boolean;
      autoGenerateMcp?: boolean;
      maxRepairAttempts?: number;
    },
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId: body.tenantId,
      requireUser: true,
    });

    return this.apiUploadJobService.startJob({
      ...body,
      tenantId: auth.tenantId,
    });
  }

  @Get('upload-api-job/:jobId')
  @ApiOperation({ summary: 'Get API upload repair job details' })
  async getUploadApiJob(
    @Req() req: Request,
    @Param('jobId') jobId: string,
    @Query('tenantId') tenantId: string,
    @Query('includeContent') includeContent?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });

    return this.apiUploadJobService.getJob(jobId, auth.tenantId, {
      includeContent: includeContent === 'true',
    });
  }

  @Get('upload-api-job/:jobId/attempts')
  @ApiOperation({ summary: 'Get API upload repair attempts' })
  async getUploadApiJobAttempts(
    @Req() req: Request,
    @Param('jobId') jobId: string,
    @Query('tenantId') tenantId: string,
    @Query('includeContent') includeContent?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });

    return this.apiUploadJobService.getAttempts(jobId, auth.tenantId, {
      includeContent: includeContent === 'true',
    });
  }

  @Get('upload-history')
  @ApiOperation({ summary: 'Get API upload history' })
  async getUploadHistory(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.apiUploadService.getUploadHistory(auth.tenantId, connectorId);
  }
}
