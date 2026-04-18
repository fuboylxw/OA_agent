import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class ChatRetentionService {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(private readonly prisma: PrismaService) {
    setInterval(() => {
      void this.purgeExpiredArchivedConversations().catch((error) => {
        this.logger.warn(`Archived chat cleanup failed: ${error?.message || error}`);
      });
    }, 6 * 60 * 60 * 1000).unref();
  }

  async purgeExpiredArchivedConversations() {
    const now = new Date();
    const expiredSessions = await this.prisma.chatSession.findMany({
      where: {
        status: 'archived',
        retainedUntil: { lt: now },
      },
      select: { id: true },
      take: 200,
    });

    if (expiredSessions.length === 0) {
      return 0;
    }

    const ids = expiredSessions.map((item) => item.id);
    await this.prisma.chatSession.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'purged',
        purgedAt: now,
        restorableUntil: now,
      },
    });
    await this.prisma.chatMessage.deleteMany({
      where: { sessionId: { in: ids } },
    });
    return ids.length;
  }
}
