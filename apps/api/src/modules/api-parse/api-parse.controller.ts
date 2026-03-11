import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiParseService } from './api-parse.service';
import { SyncService } from './sync.service';
import { FlowDiscoveryService } from './flow-discovery.service';
import { ParseAndGenerateInput } from './types';

@Controller('api-parse')
export class ApiParseController {
  constructor(
    private readonly apiParseService: ApiParseService,
    private readonly syncService: SyncService,
    private readonly flowDiscovery: FlowDiscoveryService,
  ) {}

  /**
   * 完整流水线：文档 → 标准化 → 识别 → 验证 → 生成
   */
  @Post('parse-and-generate')
  @HttpCode(HttpStatus.OK)
  async parseAndGenerate(@Body() input: ParseAndGenerateInput) {
    return this.apiParseService.parseAndGenerate(input);
  }

  /**
   * 仅预览文档标准化结果（不写库）
   */
  @Post('preview-normalize')
  @HttpCode(HttpStatus.OK)
  async previewNormalize(
    @Body() body: { content: string; formatHint?: string },
  ) {
    return this.apiParseService.previewNormalize(body.content, body.formatHint);
  }

  /**
   * 验证 connector 已有端点的可达性
   */
  @Post('validate/:connectorId')
  @HttpCode(HttpStatus.OK)
  async validateConnector(@Param('connectorId') connectorId: string) {
    return this.apiParseService.validateConnector(connectorId);
  }

  /**
   * 接收 OA 系统的 webhook 回调
   */
  @Post('webhook/:connectorId')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('connectorId') connectorId: string,
    @Body() payload: Record<string, any>,
  ) {
    return this.syncService.handleWebhook(connectorId, payload);
  }

  /**
   * 手动触发单条 submission 同步
   */
  @Post('sync/:submissionId')
  @HttpCode(HttpStatus.OK)
  async syncOnDemand(@Param('submissionId') submissionId: string) {
    return this.syncService.syncOnDemand(submissionId);
  }

  /**
   * 手动触发全量轮询（管理员用）
   */
  @Post('sync-all')
  @HttpCode(HttpStatus.OK)
  async pollAll() {
    return this.syncService.pollPendingSubmissions();
  }

  /**
   * 列出 connector 下所有可用流程（本地 + 远程发现）
   */
  @Get('flows/:connectorId')
  async listFlows(@Param('connectorId') connectorId: string) {
    return this.flowDiscovery.listAllFlows(connectorId);
  }

  /**
   * 主动触发远程流程发现
   */
  @Post('flows/:connectorId/discover')
  @HttpCode(HttpStatus.OK)
  async discoverFlows(@Param('connectorId') connectorId: string) {
    return this.flowDiscovery.discoverFlows(connectorId);
  }

  /**
   * 按关键词搜索流程（AI 对话时调用）
   */
  @Get('flows/:connectorId/search')
  async searchFlow(
    @Param('connectorId') connectorId: string,
    @Query('keyword') keyword: string,
  ) {
    const result = await this.flowDiscovery.findFlow(connectorId, keyword);
    return result || { found: false, message: '未找到匹配的流程' };
  }
}
