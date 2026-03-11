import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { DocumentParserController } from './document-parser.controller';
import { DocumentParserService } from './document-parser.service';
import { ApiDocumentParserAgent } from './agents/api-document-parser.agent';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'bootstrap',
    }),
  ],
  controllers: [
    BootstrapController,
    // DocumentParserController 保留，供历史解析结果查询使用
    DocumentParserController,
  ],
  providers: [
    BootstrapService,
    // DocumentParserService 保留，供 DocumentParserController 查询使用
    DocumentParserService,
    ApiDocumentParserAgent,
    PrismaService,
  ],
  exports: [BootstrapService],
})
export class BootstrapModule {}
