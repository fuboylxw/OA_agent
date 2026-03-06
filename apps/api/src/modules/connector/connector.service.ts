import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateConnectorDto, UpdateConnectorDto } from './dto';
import { AdapterFactory } from '@uniflow/oa-adapters';

@Injectable()
export class ConnectorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateConnectorDto) {
    const tenantId = process.env.DEFAULT_TENANT_ID || 'default-tenant';

    return this.prisma.connector.create({
      data: {
        tenantId,
        name: dto.name,
        oaType: dto.oaType,
        oaVendor: dto.oaVendor,
        oaVersion: dto.oaVersion,
        baseUrl: dto.baseUrl,
        authType: dto.authType,
        authConfig: dto.authConfig,
        healthCheckUrl: dto.healthCheckUrl,
        oclLevel: dto.oclLevel,
        falLevel: dto.falLevel,
        status: 'active',
      },
    });
  }

  async list(tenantId: string) {
    return this.prisma.connector.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const connector = await this.prisma.connector.findUnique({
      where: { id },
      include: {
        processTemplates: {
          where: { status: 'published' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    return connector;
  }

  async update(id: string, dto: UpdateConnectorDto) {
    return this.prisma.connector.update({
      where: { id },
      data: {
        name: dto.name,
        oaVendor: dto.oaVendor,
        oaVersion: dto.oaVersion,
        baseUrl: dto.baseUrl,
        authType: dto.authType,
        authConfig: dto.authConfig,
        healthCheckUrl: dto.healthCheckUrl,
        oclLevel: dto.oclLevel,
        falLevel: dto.falLevel,
        status: dto.status,
      },
    });
  }

  async delete(id: string) {
    // 获取 connector 信息
    const connector = await this.prisma.connector.findUnique({
      where: { id },
      include: {
        processTemplates: {
          select: { id: true },
        },
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    const templateIds = connector.processTemplates.map((t) => t.id);

    // 使用事务进行级联删除
    return this.prisma.$transaction(async (tx) => {
      // 1. 删除所有相关的 Submission 的状态记录
      if (templateIds.length > 0) {
        const submissions = await tx.submission.findMany({
          where: { templateId: { in: templateIds } },
          select: { id: true },
        });
        const submissionIds = submissions.map((s) => s.id);

        if (submissionIds.length > 0) {
          await tx.submissionStatus.deleteMany({
            where: { submissionId: { in: submissionIds } },
          });
        }

        // 2. 删除所有相关的 Submission
        await tx.submission.deleteMany({
          where: { templateId: { in: templateIds } },
        });

        // 3. 删除所有相关的 ProcessDraft
        await tx.processDraft.deleteMany({
          where: { templateId: { in: templateIds } },
        });

        // 4. 删除所有相关的 ProcessTemplate
        await tx.processTemplate.deleteMany({
          where: { id: { in: templateIds } },
        });
      }

      // 5. 删除所有相关的 MCPTool
      await tx.mCPTool.deleteMany({
        where: { connectorId: id },
      });

      // 6. 最后删除 Connector
      return tx.connector.delete({
        where: { id },
      });
    });
  }

  async healthCheck(id: string) {
    const connector = await this.get(id);

    // Create mock adapter for health check
    const adapter = AdapterFactory.createMockAdapter(
      connector.oaType as any,
      [],
    );

    const result = await adapter.healthCheck();

    // Update last health check time
    await this.prisma.connector.update({
      where: { id },
      data: {
        lastHealthCheck: new Date(),
        status: result.healthy ? 'active' : 'inactive',
      },
    });

    return result;
  }
}
