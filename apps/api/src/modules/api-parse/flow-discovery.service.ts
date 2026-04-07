import { Injectable, Logger } from '@nestjs/common';
import { normalizeProcessName } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { GenericHttpAdapter } from '../adapter-runtime/generic-http-adapter';

@Injectable()
export class FlowDiscoveryService {
  private readonly logger = new Logger(FlowDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntime: AdapterRuntimeService,
  ) {}

  async discoverFlows(connectorId: string, tenantId: string): Promise<DiscoveredFlow[]> {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!connector) {
      this.logger.warn(`Connector ${connectorId} not found for tenant ${tenantId}`);
      return [];
    }

    const flowListTool = await this.prisma.mCPTool.findFirst({
      where: {
        connectorId: connector.id,
        tenantId,
        category: 'flow_list',
        enabled: true,
      },
      select: {
        apiEndpoint: true,
        httpMethod: true,
        responseMapping: true,
      },
    });

    if (!flowListTool) {
      this.logger.log(`Connector ${connectorId}: no flow_list tool, skipping discovery`);
      return [];
    }

    let adapter;
    try {
      adapter = await this.adapterRuntime.createAdapterForConnector(connector.id);

      if (!('callEndpoint' in adapter)) {
        this.logger.log(`Connector ${connectorId}: adapter does not support callEndpoint`);
        return [];
      }

      const genericAdapter = adapter as GenericHttpAdapter;
      const response = await genericAdapter.callEndpoint(
        flowListTool.apiEndpoint,
        flowListTool.httpMethod,
        {},
      );

      const mapping = (flowListTool.responseMapping || {}) as Record<string, any>;
      const listPath = typeof mapping.listPath === 'string' ? mapping.listPath : 'data';
      const codeField = typeof mapping.code === 'string' ? mapping.code : 'code';
      const nameField = typeof mapping.name === 'string' ? mapping.name : 'name';
      const categoryField = typeof mapping.category === 'string' ? mapping.category : 'category';

      const items = this.extractField(response, listPath);
      if (!Array.isArray(items)) {
        this.logger.warn(`Connector ${connectorId}: flow list at "${listPath}" is not an array`);
        return [];
      }

      const genericSubmitTool = await this.prisma.mCPTool.findFirst({
        where: {
          connectorId: connector.id,
          tenantId,
          flowCode: 'generic_application',
          category: 'submit',
        },
        select: {
          apiEndpoint: true,
          httpMethod: true,
        },
      });

      const discovered: DiscoveredFlow[] = [];

      for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
          continue;
        }

        const item = rawItem as Record<string, any>;
        const remoteCode = item[codeField];
        if (!remoteCode) {
          continue;
        }

        const processCode = this.toProcessCode(String(remoteCode));
        const processName = normalizeProcessName({
          processName: String(item[nameField] || remoteCode),
          processCode,
        });
        const category = String(item[categoryField] || 'other');

        const existing = await this.prisma.processTemplate.findFirst({
          where: {
            connectorId: connector.id,
            tenantId,
            processCode,
          },
          select: {
            id: true,
          },
        });

        if (existing) {
          discovered.push({
            processCode,
            processName,
            category,
            isNew: false,
            templateId: existing.id,
          });
          continue;
        }

        const template = await this.prisma.processTemplate.create({
          data: {
            tenantId,
            connectorId: connector.id,
            processCode,
            processName,
            processCategory: category,
            description: `${processName} (runtime discovered)`,
            version: 1,
            status: 'published',
            falLevel: 'F2',
            schema: {
              fields: [],
              submitEndpoint: genericSubmitTool?.apiEndpoint,
              submitMethod: genericSubmitTool?.httpMethod,
              flowTypeParam: codeField,
              flowTypeValue: remoteCode,
            },
            publishedAt: new Date(),
          },
        });

        discovered.push({
          processCode,
          processName,
          category,
          isNew: true,
          templateId: template.id,
        });
      }

      this.logger.log(
        `Connector ${connectorId}: discovered ${discovered.length} flows (${discovered.filter((flow) => flow.isNew).length} new)`,
      );

      return discovered;
    } catch (error: any) {
      this.logger.error(`Flow discovery failed for connector ${connectorId}: ${error.message}`);
      return [];
    } finally {
      if (adapter) {
        await this.adapterRuntime.destroyAdapter(adapter);
      }
    }
  }

  async findFlow(
    connectorId: string,
    tenantId: string,
    keyword: string,
  ): Promise<DiscoveredFlow | null> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      return null;
    }

    const local = await this.prisma.processTemplate.findFirst({
      where: {
        connectorId,
        tenantId,
        status: 'published',
        OR: [
          { processName: { contains: normalizedKeyword } },
          { processCode: { contains: normalizedKeyword } },
          { description: { contains: normalizedKeyword } },
        ],
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        processCode: true,
        processName: true,
        processCategory: true,
      },
    });

    if (local) {
      return {
        processCode: local.processCode,
        processName: normalizeProcessName({
          processName: local.processName,
          processCode: local.processCode,
        }),
        category: local.processCategory || 'other',
        isNew: false,
        templateId: local.id,
      };
    }

    const discovered = await this.discoverFlows(connectorId, tenantId);
    if (discovered.length === 0) {
      return null;
    }

    const loweredKeyword = normalizedKeyword.toLowerCase();
    return (
      discovered.find(
        (flow) =>
          flow.processName.toLowerCase().includes(loweredKeyword) ||
          flow.processCode.toLowerCase().includes(loweredKeyword),
      ) || null
    );
  }

  async listAllFlows(connectorId: string, tenantId: string): Promise<DiscoveredFlow[]> {
    const localTemplates = await this.prisma.processTemplate.findMany({
      where: {
        connectorId,
        tenantId,
        status: 'published',
      },
      orderBy: [
        { processName: 'asc' },
        { version: 'desc' },
      ],
      select: {
        id: true,
        processCode: true,
        processName: true,
        processCategory: true,
      },
    });

    const result = new Map<string, DiscoveredFlow>();
    for (const template of localTemplates) {
      if (!result.has(template.processCode)) {
        result.set(template.processCode, {
          processCode: template.processCode,
          processName: normalizeProcessName({
            processName: template.processName,
            processCode: template.processCode,
          }),
          category: template.processCategory || 'other',
          isNew: false,
          templateId: template.id,
        });
      }
    }

    const current = [...result.values()];
    const hasOnlyGeneric =
      current.length === 0 ||
      (current.length <= 1 && current.every((flow) => flow.processCode === 'generic_application'));

    if (hasOnlyGeneric) {
      const discovered = await this.discoverFlows(connectorId, tenantId);
      for (const flow of discovered) {
        if (!result.has(flow.processCode)) {
          result.set(flow.processCode, flow);
        }
      }
    }

    return [...result.values()];
  }

  private extractField(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private toProcessCode(raw: string): string {
    return (
      raw
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase()
        .substring(0, 120) || 'unknown_flow'
    );
  }
}

export interface DiscoveredFlow {
  processCode: string;
  processName: string;
  category: string;
  isNew: boolean;
  templateId: string;
}
