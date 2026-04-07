import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { TaskPacket } from '@uniflow/shared-types';
import { PrismaService } from '../../common/prisma.service';
import { DeliveryCapabilityRouter } from '../delivery-capability.router';
import { ContextManager } from '../context/context.manager';
import { ConnectorRouter } from './connector-router';
import { FlowAgent } from './flow.agent';

interface BuildSubmitTaskPacketInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  message: string;
  formData?: Record<string, any>;
  idempotencyKey: string;
  traceId: string;
}

interface BuildSubmitTaskPacketFromDraftInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  draftId: string;
  idempotencyKey: string;
  traceId: string;
}

export interface BuildTaskPacketResult {
  taskPacket?: TaskPacket;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

@Injectable()
export class TaskPlanAgent {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextManager: ContextManager,
    private readonly connectorRouter: ConnectorRouter,
    private readonly flowAgent: FlowAgent,
    private readonly deliveryCapabilityRouter: DeliveryCapabilityRouter,
  ) {}

  async buildSubmitTaskPacket(input: BuildSubmitTaskPacketInput): Promise<BuildTaskPacketResult> {
    const sessionContext = await this.contextManager.getSessionContext(input.sessionId);
    const connectorRoute = await this.connectorRouter.route(
      input.tenantId,
      input.userId,
      input.message,
      sessionContext.currentConnectorId,
    );

    if (connectorRoute.needsSelection || !connectorRoute.connectorId) {
      return {
        needsClarification: true,
        clarificationQuestion: connectorRoute.selectionQuestion || '请选择要办理的 OA 系统。',
      };
    }

    const templates = await this.prisma.processTemplate.findMany({
      where: {
        tenantId: input.tenantId,
        connectorId: connectorRoute.connectorId,
        status: 'published',
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        processCode: true,
        processName: true,
        processCategory: true,
      },
    });

    const uniqueFlows = new Map<string, { processCode: string; processName: string; processCategory: string }>();
    for (const template of templates) {
      if (!uniqueFlows.has(template.processCode)) {
        uniqueFlows.set(template.processCode, {
          processCode: template.processCode,
          processName: template.processName,
          processCategory: template.processCategory || 'general',
        });
      }
    }

    const flowMatch = await this.flowAgent.matchFlow('submit', input.message, [...uniqueFlows.values()]);
    if (flowMatch.needsClarification || !flowMatch.matchedFlow) {
      return {
        needsClarification: true,
        clarificationQuestion: flowMatch.clarificationQuestion || '请明确要办理的流程。',
      };
    }

    const template = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId: input.tenantId,
        connectorId: connectorRoute.connectorId,
        processCode: flowMatch.matchedFlow.processCode,
        status: 'published',
      },
      include: {
        connector: true,
      },
      orderBy: { version: 'desc' },
    });

    if (!template) {
      return {
        needsClarification: true,
        clarificationQuestion: `未找到流程 ${flowMatch.matchedFlow.processName} 的可用模板。`,
      };
    }

    const capability = this.deliveryCapabilityRouter.resolveForTemplateRecord(template);
    const selectedPath = this.deliveryCapabilityRouter.selectPrimaryPath(capability, 'submit');
    if (!selectedPath) {
      return {
        needsClarification: true,
        clarificationQuestion: `流程 ${template.processName} 当前没有可用的交付路径，请检查初始化配置。`,
      };
    }

    const formData = {
      ...(sessionContext.currentFormData || {}),
      ...(input.formData || {}),
    };
    const taskPacket: TaskPacket = {
      taskId: randomUUID(),
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      objective: {
        intent: 'submit',
        processCode: template.processCode,
        processName: template.processName,
      },
      selectedPath,
      fallbackPolicy: capability.fallbackOrder || [selectedPath],
      connector: {
        connectorId: template.connectorId,
        connectorName: template.connector?.name || connectorRoute.connectorName || 'unknown',
      },
      form: {
        formData,
        missingFields: [],
      },
      capability,
      runtime: {
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        timeoutMs: 120000,
      },
      artifactRefs: [],
    };

    await this.contextManager.patchSessionContext(input.sessionId, {
      currentConnectorId: template.connectorId,
      currentConnectorName: template.connector?.name || connectorRoute.connectorName || null,
      currentProcessCode: template.processCode,
      currentProcessName: template.processName,
      currentTemplateId: template.id,
      currentFormData: formData,
      selectedPath,
      fallbackPolicy: taskPacket.fallbackPolicy,
      processStatus: 'planning',
    });
    await this.contextManager.createExecutionContext(taskPacket.taskId, taskPacket);

    return {
      taskPacket,
      needsClarification: false,
    };
  }

  async buildSubmitTaskPacketFromDraft(input: BuildSubmitTaskPacketFromDraftInput): Promise<BuildTaskPacketResult> {
    const [sessionContext, draft] = await Promise.all([
      this.contextManager.getSessionContext(input.sessionId),
      this.prisma.processDraft.findUnique({
        where: { id: input.draftId },
        include: {
          template: {
            include: {
              connector: true,
            },
          },
        },
      }),
    ]);

    if (!draft?.template) {
      return {
        needsClarification: true,
        clarificationQuestion: '未找到可提交的草稿或流程模板。',
      };
    }

    const capability = this.deliveryCapabilityRouter.resolveForTemplateRecord(draft.template);
    const selectedPath = this.deliveryCapabilityRouter.selectPrimaryPath(capability, 'submit');
    if (!selectedPath) {
      return {
        needsClarification: true,
        clarificationQuestion: `流程 ${draft.template.processName} 当前没有可用的交付路径，请检查初始化配置。`,
      };
    }

    const formData = {
      ...(sessionContext.currentFormData || {}),
      ...((draft.formData as Record<string, any>) || {}),
    };
    const taskPacket: TaskPacket = {
      taskId: randomUUID(),
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      objective: {
        intent: 'submit',
        processCode: draft.template.processCode,
        processName: draft.template.processName,
      },
      selectedPath,
      fallbackPolicy: capability.fallbackOrder || [selectedPath],
      connector: {
        connectorId: draft.template.connectorId,
        connectorName: draft.template.connector?.name || 'unknown',
      },
      form: {
        formData,
        missingFields: [],
      },
      capability,
      runtime: {
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId,
        timeoutMs: 120000,
      },
      artifactRefs: [],
    };

    await this.contextManager.patchSessionContext(input.sessionId, {
      currentConnectorId: draft.template.connectorId,
      currentConnectorName: draft.template.connector?.name || null,
      currentProcessCode: draft.template.processCode,
      currentProcessName: draft.template.processName,
      currentTemplateId: draft.template.id,
      currentFormData: formData,
      selectedPath,
      fallbackPolicy: taskPacket.fallbackPolicy,
      processStatus: 'planning',
    });
    await this.contextManager.createExecutionContext(taskPacket.taskId, taskPacket);

    return {
      taskPacket,
      needsClarification: false,
    };
  }
}
