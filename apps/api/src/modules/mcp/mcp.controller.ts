import { Controller, Get, Post, Body, Param, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { MCPService } from './mcp.service';
import { MCPExecutorService } from './mcp-executor.service';
import { ApiUploadService } from './api-upload.service';

@ApiTags('MCP Tools')
@Controller('mcp')
export class MCPController {
  constructor(
    private readonly mcpService: MCPService,
    private readonly mcpExecutor: MCPExecutorService,
    private readonly apiUploadService: ApiUploadService,
  ) {}

  @Get('tools')
  @ApiOperation({ summary: 'List MCP tools for a connector' })
  async listTools(
    @Query('connectorId') connectorId: string,
    @Query('category') category?: string,
  ) {
    return this.mcpService.listTools(connectorId, category);
  }

  @Get('tools/:toolName')
  @ApiOperation({ summary: 'Get MCP tool details' })
  async getTool(
    @Param('toolName') toolName: string,
    @Query('connectorId') connectorId: string,
  ) {
    return this.mcpService.getTool(connectorId, toolName);
  }

  @Post('tools/:toolName/execute')
  @ApiOperation({ summary: 'Execute an MCP tool' })
  async executeTool(
    @Param('toolName') toolName: string,
    @Body() body: { connectorId: string; params: Record<string, any> },
  ) {
    return this.mcpExecutor.executeTool(
      toolName,
      body.params,
      body.connectorId,
    );
  }

  @Post('tools/:toolName/test')
  @ApiOperation({ summary: 'Test an MCP tool with sample data' })
  async testTool(
    @Param('toolName') toolName: string,
    @Query('connectorId') connectorId: string,
  ) {
    const tool = await this.mcpService.getTool(connectorId, toolName);

    if (!tool.testInput) {
      return { error: 'No test input defined for this tool' };
    }

    return this.mcpExecutor.executeTool(
      toolName,
      tool.testInput as Record<string, any>,
      connectorId,
    );
  }

  @Post('upload-api')
  @ApiOperation({ summary: 'Upload API documentation and auto-generate MCP tools' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadApiFile(
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
    const docContent = file ? file.buffer.toString('utf-8') : '';
    const authConfig = JSON.parse(body.authConfig || '{}');

    return this.apiUploadService.uploadAndProcess({
      tenantId: body.tenantId,
      connectorId: body.connectorId,
      docType: body.docType,
      docContent,
      oaUrl: body.oaUrl,
      authConfig,
      autoValidate: body.autoValidate === 'true',
      autoGenerateMcp: body.autoGenerateMcp === 'true',
    });
  }

  @Post('upload-api-json')
  @ApiOperation({ summary: 'Upload API documentation (JSON body) and auto-generate MCP tools' })
  async uploadApiJson(
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
    return this.apiUploadService.uploadAndProcess(body);
  }

  @Get('upload-history')
  @ApiOperation({ summary: 'Get API upload history' })
  async getUploadHistory(
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId: string,
  ) {
    return this.apiUploadService.getUploadHistory(tenantId, connectorId);
  }
}
