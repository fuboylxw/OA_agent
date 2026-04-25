import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DEFAULT_DELIVERY_PATH,
  DELIVERY_PATHS,
  resolveProcessRuntimeManifest,
  type DeliveryPath,
} from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { ApiDeliveryAgent } from './api-delivery.agent';
import type {
  DeliveryAgent,
  DeliveryStatusExecutionResult,
  DeliveryStatusRequest,
  DeliverySubmitExecutionResult,
  DeliverySubmitRequest,
} from './delivery-agent.types';
import { buildExecutionOrder, resolveAvailablePaths } from './delivery-path-resolver';
import { UrlDeliveryAgent } from './url-delivery.agent';
import { VisionDeliveryAgent } from './vision-delivery.agent';

@Injectable()
export class DeliveryOrchestratorService {
  private readonly agents: Map<DeliveryPath, DeliveryAgent>;

  constructor(
    private readonly prisma: PrismaService,
    apiDeliveryAgent: ApiDeliveryAgent,
    urlDeliveryAgent: UrlDeliveryAgent,
    visionDeliveryAgent: VisionDeliveryAgent,
  ) {
    const registrations: Array<[DeliveryPath, DeliveryAgent]> = [
      [apiDeliveryAgent.path, apiDeliveryAgent],
      [urlDeliveryAgent.path, urlDeliveryAgent],
      [visionDeliveryAgent.path, visionDeliveryAgent],
    ];
    const registeredPaths = registrations.map(([path]) => path);
    if (new Set(registeredPaths).size !== registeredPaths.length) {
      throw new Error(`Duplicate delivery agent path registration: ${registeredPaths.join(', ')}`);
    }
    if (registeredPaths.length !== DELIVERY_PATHS.length) {
      throw new Error(`Expected ${DELIVERY_PATHS.length} delivery agents, received ${registeredPaths.length}`);
    }
    this.agents = new Map<DeliveryPath, DeliveryAgent>(registrations);
  }

  async submit(request: DeliverySubmitRequest): Promise<DeliverySubmitExecutionResult> {
    const prepared = await this.prepareExecution('submit', request.connectorId, request.processCode);
    const executionOrder = buildExecutionOrder(
      request.selectedPath,
      request.fallbackPolicy,
      prepared.availablePaths,
    );
    let lastResult: DeliverySubmitExecutionResult | null = null;

    for (const path of executionOrder) {
      const agent = this.agents.get(path);
      if (!agent) {
        continue;
      }

      const result = await agent.submit({
        ...request,
        taskId: prepared.taskId,
        templateId: prepared.template.id,
        processName: request.processName || prepared.template.processName,
        uiHints: prepared.uiHints,
      });
      lastResult = result;

      if (result.packet.success && result.submitResult.success) {
        return result;
      }

      if (result.packet.fallbackHint?.shouldFallback === false) {
        break;
      }
    }

    return lastResult || this.buildSubmitFailure(prepared.taskId, request, executionOrder);
  }

  async queryStatus(request: DeliveryStatusRequest): Promise<DeliveryStatusExecutionResult> {
    const prepared = await this.prepareExecution('queryStatus', request.connectorId, request.processCode);
    const executionOrder = buildExecutionOrder(
      request.selectedPath,
      request.fallbackPolicy,
      prepared.availablePaths,
    );
    let lastResult: DeliveryStatusExecutionResult | null = null;

    for (const path of executionOrder) {
      const agent = this.agents.get(path);
      if (!agent) {
        continue;
      }

      const result = await agent.queryStatus({
        ...request,
        taskId: prepared.taskId,
        templateId: prepared.template.id,
        processName: request.processName || prepared.template.processName,
        uiHints: prepared.uiHints,
      });
      lastResult = result;

      if (result.packet.success && result.statusResult.status !== 'error') {
        return result;
      }

      if (result.packet.fallbackHint?.shouldFallback === false) {
        break;
      }
    }

    return lastResult || this.buildStatusFailure(prepared.taskId, request, executionOrder);
  }

  private async prepareExecution(
    action: 'submit' | 'queryStatus',
    connectorId: string,
    processCode: string,
  ) {
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        connectorId,
        processCode,
        status: 'published',
      },
      orderBy: { version: 'desc' },
    });

    if (!template) {
      throw new Error(`Published process template not found for ${processCode}`);
    }

    const uiHints = ((template.uiHints as Record<string, any> | null) || {});
    const runtimeResolution = resolveProcessRuntimeManifest(uiHints);

    return {
      taskId: randomUUID(),
      template,
      uiHints,
      availablePaths: resolveAvailablePaths(
        runtimeResolution.manifest ? { ...uiHints, runtimeManifest: runtimeResolution.manifest } : uiHints,
        action,
      ),
    };
  }

  private buildSubmitFailure(
    taskId: string,
    request: DeliverySubmitRequest,
    attemptedPaths: DeliveryPath[],
  ): DeliverySubmitExecutionResult {
    const errorMessage = `No delivery agent succeeded for ${request.processCode}`;
    return {
      submitResult: {
        success: false,
        errorMessage,
        metadata: {
          connectorId: request.connectorId,
          flowCode: request.processCode,
          attemptedPaths,
        },
      },
      packet: {
        taskId,
        agentType: request.selectedPath || attemptedPaths[0] || DEFAULT_DELIVERY_PATH,
        success: false,
        fallbackHint: {
          shouldFallback: false,
          errorType: 'delivery_failed',
          reason: errorMessage,
        },
        evidence: {
          artifactRefs: [],
          summary: errorMessage,
        },
        statePatch: {
          lastExecutionPath: request.selectedPath || attemptedPaths[0] || DEFAULT_DELIVERY_PATH,
          currentOaSubmissionId: null,
        },
      },
    };
  }

  private buildStatusFailure(
    taskId: string,
    request: DeliveryStatusRequest,
    attemptedPaths: DeliveryPath[],
  ): DeliveryStatusExecutionResult {
    const errorMessage = `No delivery agent succeeded for ${request.processCode}`;
    return {
      statusResult: {
        status: 'error',
        statusDetail: {
          error: errorMessage,
          connectorId: request.connectorId,
          flowCode: request.processCode,
          attemptedPaths,
        },
      },
      packet: {
        taskId,
        agentType: request.selectedPath || attemptedPaths[0] || DEFAULT_DELIVERY_PATH,
        success: false,
        fallbackHint: {
          shouldFallback: false,
          errorType: 'delivery_failed',
          reason: errorMessage,
        },
        evidence: {
          artifactRefs: [],
          summary: errorMessage,
        },
        statePatch: {
          lastExecutionPath: request.selectedPath || attemptedPaths[0] || DEFAULT_DELIVERY_PATH,
          currentOaSubmissionId: request.submissionId,
        },
      },
    };
  }
}
