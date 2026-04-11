import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class TenantUserResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    tenantId: string;
    userId?: string | null;
    allowFallback?: boolean;
  }) {
    const tenantId = input.tenantId?.trim();
    const userId = input.userId?.trim();

    if (!tenantId) {
      throw new BadRequestException('缺少租户标识');
    }

    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
      });

      if (user) {
        if (user.status !== 'active') {
          throw new BadRequestException('当前用户已被禁用，请重新登录');
        }

        return user;
      }

      if (!input.allowFallback) {
        throw new BadRequestException('无效的用户身份，请重新登录');
      }
    } else if (!input.allowFallback) {
      throw new BadRequestException('缺少用户身份，请重新登录');
    }

    // In production, never allow fallback to arbitrary tenant user
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('生产环境不允许用户身份回退，请提供有效的用户凭证');
    }

    const fallbackUser = await this.prisma.user.findFirst({
      where: {
        tenantId,
        status: 'active',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!fallbackUser) {
      throw new BadRequestException('当前租户下没有可用用户');
    }

    return fallbackUser;
  }
}
