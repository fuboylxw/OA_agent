import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

type ProcessLibraryItem = {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  status: string;
  falLevel: string | null;
  uiHints: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  sourceType: 'published' | 'bootstrap_candidate';
  connector?: {
    id: string;
    name: string;
    oaType: string;
    oclLevel: string;
  } | null;
  bootstrapJobId?: string;
  bootstrapJobStatus?: string;
};

@Injectable()
export class ProcessLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, category?: string) {
    const publishedTemplates = await this.prisma.processTemplate.findMany({
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

    const bootstrapJobs = await this.prisma.bootstrapJob.findMany({
      where: {
        tenantId,
        status: { in: ['VALIDATION_FAILED', 'PARTIALLY_PUBLISHED'] },
      },
      select: {
        id: true,
        status: true,
        name: true,
        oaUrl: true,
        openApiUrl: true,
        createdAt: true,
        updatedAt: true,
        flowIRs: {
          select: {
            id: true,
            flowCode: true,
            flowName: true,
            flowCategory: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const pendingCandidates = bootstrapJobs.flatMap((job) => {
      return job.flowIRs
        .map<ProcessLibraryItem | null>((flow) => {
          const metadata = (flow.metadata as Record<string, any> | null) || {};
          const validation = (metadata.validation as Record<string, any> | null) || {};
          const repair = (metadata.repair as Record<string, any> | null) || null;
          if (validation.status === 'passed') {
            return null;
          }

          if (category && flow.flowCategory !== category) {
            return null;
          }

          const normalizedStatus = validation.status === 'partial'
            ? 'validation_partial'
            : 'validation_failed';

          return {
            id: flow.id,
            processCode: flow.flowCode,
            processName: flow.flowName,
            processCategory: flow.flowCategory || null,
            status: normalizedStatus,
            falLevel: null,
            uiHints: {
              validationResult: validation,
              repairResult: repair,
              bootstrapJobId: job.id,
              bootstrapJobStatus: job.status,
              bootstrapJobName: job.name,
              retryUrl: `/bootstrap/${job.id}`,
              sourceUrl: job.oaUrl || job.openApiUrl || null,
            },
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            sourceType: 'bootstrap_candidate',
            connector: null,
            bootstrapJobId: job.id,
            bootstrapJobStatus: job.status,
          };
        })
        .filter((item): item is ProcessLibraryItem => !!item);
    });

    const publishedItems: ProcessLibraryItem[] = publishedTemplates.map((template) => ({
      id: template.id,
      processCode: template.processCode,
      processName: template.processName,
      processCategory: template.processCategory || null,
      status: template.status,
      falLevel: template.falLevel,
      uiHints: (template.uiHints as Record<string, any> | null) || null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      sourceType: 'published',
      connector: template.connector,
    }));

    return [...pendingCandidates, ...publishedItems].sort((a, b) => {
      const statusRank = (value: string) => {
        if (value === 'validation_failed' || value === 'validation_partial') return 0;
        if (value === 'published') return 1;
        return 2;
      };

      const categoryCompare = (a.processCategory || '').localeCompare(b.processCategory || '', 'zh-CN');
      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      const statusCompare = statusRank(a.status) - statusRank(b.status);
      if (statusCompare !== 0) {
        return statusCompare;
      }

      return a.processName.localeCompare(b.processName, 'zh-CN');
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
