import { PrismaService } from '../common/prisma.service';
import { parseRpaFlowDefinitions, type RpaFlowDefinition } from '@uniflow/shared-types';

export interface LoadedRpaFlow {
  processCode: string;
  processName: string;
  executionModes: {
    submit: string[];
    queryStatus: string[];
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
      const parsed = parseRpaFlowDefinitions(uiHints.rpaDefinition ? [uiHints.rpaDefinition] : []);
      const definition = parsed[0];
      if (!definition) {
        continue;
      }

      const executionModes = uiHints.executionModes as Record<string, any> | undefined;

      flows.push({
        processCode: template.processCode,
        processName: template.processName,
        executionModes: {
          submit: normalizeModes(executionModes?.submit),
          queryStatus: normalizeModes(executionModes?.queryStatus),
        },
        rpaDefinition: definition,
      });
    }

    return flows;
  }
}

function normalizeModes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase());
}
