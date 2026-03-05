import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { BootstrapStateMachine } from './bootstrap.state-machine';
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
    DocumentParserController,
  ],
  providers: [
    BootstrapService,
    BootstrapStateMachine,
    DocumentParserService,
    ApiDocumentParserAgent,
    PrismaService,
  ],
  exports: [BootstrapService, DocumentParserService],
})
export class BootstrapModule {}
