import {
  API_DELIVERY_PATH,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
} from '@uniflow/shared-types';
import { DeliveryOrchestratorService } from './delivery-orchestrator.service';

describe('DeliveryOrchestratorService', () => {
  it('falls back from vision to url when vision delivery fails', async () => {
    const prisma = {
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'template-1',
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          uiHints: {
            executionModes: {
              submit: ['rpa'],
            },
            rpaDefinition: {
              processCode: 'leave_apply',
              processName: 'Leave Apply',
              platform: {
                entryUrl: 'https://oa.example.com/leave',
              },
              actions: {
                submit: {
                  steps: [{
                    type: 'click',
                    target: {
                      kind: 'image',
                      value: 'submit-button.png',
                    },
                  }],
                },
              },
            },
          },
        }),
      },
    };
    const apiAgent = {
      path: API_DELIVERY_PATH,
      submit: jest.fn(),
      queryStatus: jest.fn(),
    };
    const urlAgent = {
      path: URL_DELIVERY_PATH,
      submit: jest.fn().mockResolvedValue({
        submitResult: {
          success: true,
          submissionId: 'URL-123',
          metadata: { deliveryPath: URL_DELIVERY_PATH },
        },
        packet: {
          taskId: 'task-1',
          agentType: URL_DELIVERY_PATH,
          success: true,
          evidence: { artifactRefs: [], summary: 'url success' },
          statePatch: { lastExecutionPath: URL_DELIVERY_PATH, currentOaSubmissionId: 'URL-123' },
        },
      }),
      queryStatus: jest.fn(),
    };
    const visionAgent = {
      path: VISION_DELIVERY_PATH,
      submit: jest.fn().mockResolvedValue({
        submitResult: {
          success: false,
          errorMessage: 'vision failed',
        },
        packet: {
          taskId: 'task-1',
          agentType: VISION_DELIVERY_PATH,
          success: false,
          fallbackHint: {
            shouldFallback: true,
            nextPath: URL_DELIVERY_PATH,
            errorType: 'vision_failed',
            reason: 'vision failed',
          },
          evidence: { artifactRefs: [], summary: 'vision failed' },
          statePatch: { lastExecutionPath: VISION_DELIVERY_PATH, currentOaSubmissionId: null },
        },
      }),
      queryStatus: jest.fn(),
    };

    const service = new DeliveryOrchestratorService(
      prisma as any,
      apiAgent as any,
      urlAgent as any,
      visionAgent as any,
    );

    const result = await service.submit({
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      formData: { reason: 'family' },
      idempotencyKey: 'demo-key',
      selectedPath: VISION_DELIVERY_PATH,
      fallbackPolicy: [URL_DELIVERY_PATH],
    });

    expect(visionAgent.submit).toHaveBeenCalledTimes(1);
    expect(urlAgent.submit).toHaveBeenCalledTimes(1);
    expect(result.packet.agentType).toBe(URL_DELIVERY_PATH);
    expect(result.submitResult.success).toBe(true);
  });

  it('rejects duplicate path registrations instead of silently overriding an agent', () => {
    const prisma = {
      processTemplate: {
        findFirst: jest.fn(),
      },
    };
    const apiAgent = {
      path: API_DELIVERY_PATH,
      submit: jest.fn(),
      queryStatus: jest.fn(),
    };
    const duplicateUrlAgent = {
      path: URL_DELIVERY_PATH,
      submit: jest.fn(),
      queryStatus: jest.fn(),
    };
    const duplicateVisionAgent = {
      path: URL_DELIVERY_PATH,
      submit: jest.fn(),
      queryStatus: jest.fn(),
    };

    expect(() => new DeliveryOrchestratorService(
      prisma as any,
      apiAgent as any,
      duplicateUrlAgent as any,
      duplicateVisionAgent as any,
    )).toThrow('Duplicate delivery agent path registration');
  });
});
