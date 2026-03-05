import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ProcessLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, category?: string) {
    return this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        status: 'published',
        ...(category && { processCategory: category }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaType: true,
            oclLevel: true,
          },
        },
      },
      orderBy: [
        { processCategory: 'asc' },
        { processName: 'asc' },
      ],
    });
  }

  async getByCode(tenantId: string, processCode: string, version?: number) {
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode,
        status: 'published',
        ...(version && { version }),
      },
      include: {
        connector: true,
      },
      orderBy: {
        version: 'desc',
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    return template;
  }

  async getById(id: string) {
    const template = await this.prisma.processTemplate.findUnique({
      where: { id },
      include: {
        connector: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    return template;
  }

  async listVersions(tenantId: string, processCode: string) {
    return this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        processCode,
      },
      orderBy: {
        version: 'desc',
      },
    });
  }
}
