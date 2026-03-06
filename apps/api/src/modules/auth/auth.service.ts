import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRoles(roles: any): string[] {
    if (Array.isArray(roles)) {
      return roles;
    }
    if (typeof roles === 'string') {
      try {
        const parsed = JSON.parse(roles);
        return Array.isArray(parsed) ? parsed : ['user'];
      } catch {
        return ['user'];
      }
    }
    return ['user'];
  }

  async login(username: string, password: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { username, tenantId, status: 'active' },
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 简单密码校验（演示用，生产环境应使用 bcrypt）
    // 目前默认密码 = username（即用户名就是密码）
    if (password !== username && password !== '123456') {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const roles = this.parseRoles(user.roles);

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      tenantId: user.tenantId,
    };
  }

  async getUserInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles: this.parseRoles(user.roles),
      tenantId: user.tenantId,
    };
  }
}
