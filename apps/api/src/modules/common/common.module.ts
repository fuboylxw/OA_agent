import { Module, Global } from '@nestjs/common';
import { ChatSessionProcessService } from './chat-session-process.service';
import { PrismaService } from './prisma.service';
import { TenantUserResolverService } from './tenant-user-resolver.service';
import { RequestAuthService } from './request-auth.service';
import { SessionBlacklistService } from './session-blacklist.service';
import { ChatRetentionService } from './chat-retention.service';

@Global()
@Module({
  providers: [
    PrismaService,
    ChatSessionProcessService,
    TenantUserResolverService,
    RequestAuthService,
    SessionBlacklistService,
    ChatRetentionService,
  ],
  exports: [
    PrismaService,
    ChatSessionProcessService,
    TenantUserResolverService,
    RequestAuthService,
    SessionBlacklistService,
    ChatRetentionService,
  ],
})
export class CommonModule {}
