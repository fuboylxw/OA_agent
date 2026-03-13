import { Module, Global } from '@nestjs/common';
import { ChatSessionProcessService } from './chat-session-process.service';
import { PrismaService } from './prisma.service';
import { TenantUserResolverService } from './tenant-user-resolver.service';

@Global()
@Module({
  providers: [PrismaService, ChatSessionProcessService, TenantUserResolverService],
  exports: [PrismaService, ChatSessionProcessService, TenantUserResolverService],
})
export class CommonModule {}
