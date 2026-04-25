import { PrismaService } from '../common/prisma.service';
import {
  getProcessRuntimePaths,
  resolveProcessRuntimeManifest,
  type DeliveryPath,
  type RpaFlowDefinition,
} from '@uniflow/shared-types';

export interface LoadedRpaFlow {
  processCode: string;
  processName: string;
  executionModes: {
    submit: DeliveryPath[];
    queryStatus: DeliveryPath[];
  };
  rpaDefinition: RpaFlowDefinition;
}

export class PrismaRpaFlowLoader {
  constructor(private readonly prisma: PrismaService) {}

  async loadFlows(connectorId: string): Promise<LoadedRpaFlow[]> {
    const templates = await this.prisma.processTemplate.findMany({
      where: {
        connectorId,
        status: 'published',
      },
      select: {
        processCode: true,
        processName: true,
        uiHints: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const flows: LoadedRpaFlow[] = [];

    for (const template of templates) {
      const uiHints = (template.uiHints as Record<string, any> | null) || {};
      const definition = resolveProcessRuntimeManifest(uiHints).manifest?.definition;
      if (!definition) {
        continue;
      }

      flows.push({
        processCode: template.processCode,
        processName: template.processName,
        executionModes: {
          submit: getProcessRuntimePaths(uiHints, 'submit'),
          queryStatus: getProcessRuntimePaths(uiHints, 'queryStatus'),
        },
        rpaDefinition: definition,
      });
    }

    return flows;
  }
}
