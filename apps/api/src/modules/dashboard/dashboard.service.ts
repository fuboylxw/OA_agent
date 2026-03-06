import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string, userId: string) {
    // Get user info
    const user = await this.prisma.user.findFirst({
      where: { tenantId, id: userId },
      select: { displayName: true },
    });

    const displayName = user?.displayName || userId;
    const initial = displayName.charAt(0).toUpperCase();

    // Get stats in parallel
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalSubmissions,
      monthlySubmissions,
      templateCount,
      connectorCount,
      pendingSubmissions,
      connectors,
      recentSubmissions,
      recentBootstrapJobs,
    ] = await Promise.all([
      this.prisma.submission.count({ where: { tenantId, userId } }),
      this.prisma.submission.count({
        where: { tenantId, userId, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.processTemplate.count({
        where: { tenantId, status: 'published' },
      }),
      this.prisma.connector.count({ where: { tenantId } }),
      this.prisma.submission.count({
        where: { tenantId, userId, status: { in: ['pending', 'submitted'] } },
      }),
      this.prisma.connector.findMany({
        where: { tenantId },
        select: { status: true },
      }),
      this.prisma.submission.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          createdAt: true,
          templateId: true,
        },
      }),
      this.prisma.bootstrapJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    // Calculate system health
    const activeConnectors = connectors.filter((c) => c.status === 'active').length;
    const systemHealth = connectors.length > 0
      ? Math.round((activeConnectors / connectors.length) * 100)
      : 100;

    // Get template names for recent submissions
    const templateIds = [...new Set(recentSubmissions.map(s => s.templateId))];
    const templates = await this.prisma.processTemplate.findMany({
      where: { id: { in: templateIds } },
      select: { id: true, processName: true },
    });
    const templateMap = new Map(templates.map(t => [t.id, t.processName]));

    // Build recent activity
    const recentActivity = [
      ...recentSubmissions.map((s) => ({
        id: s.id,
        title: templateMap.get(s.templateId) || '提交申请',
        type: 'submission',
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
      ...recentBootstrapJobs.map((b) => ({
        id: b.id,
        title: '系统初始化任务',
        type: 'bootstrap',
        status: b.status,
        createdAt: b.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      user: { displayName, initial },
      stats: {
        totalSubmissions,
        monthlySubmissions,
        templateCount,
        connectorCount,
        pendingSubmissions,
        systemHealth,
      },
      recentActivity,
    };
  }
}
