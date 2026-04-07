import { Module, Global } from '@nestjs/common';
import { ChatSessionProcessService } from './chat-session-process.service';
import { PrismaService } from './prisma.service';
import { TenantUserResolverService } from './tenant-user-resolver.service';
import { RequestAuthService } from './request-auth.service';
import { SessionBlacklistService } from './session-blacklist.service';

@Global()
@Module({
  providers: [PrismaService, ChatSessionProcessService, TenantUserResolverService, RequestAuthService, SessionBlacklistService],
  exports: [PrismaService, ChatSessionProcessService, TenantUserResolverService, RequestAuthService, SessionBlacklistService],
})
export class CommonModule {}
