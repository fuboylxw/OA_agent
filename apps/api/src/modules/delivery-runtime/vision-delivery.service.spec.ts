import { VisionDeliveryService } from './vision-delivery.service';

describe('VisionDeliveryService', () => {
  it('submits through the vision runtime without requiring image targets', async () => {
    const runtime = {
      run: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'vision-session-1',
        provider: 'stub',
        requestedProvider: 'playwright',
        snapshots: [{
          snapshotId: 'snapshot-1',
          title: 'Leave Apply',
          url: 'https://oa.example.com/leave',
          generatedAt: new Date().toISOString(),
          regions: [],
          forms: [],
          tables: [],
          dialogs: [],
          importantTexts: [],
          interactiveElements: [],
          structuredText: '',
        }],
        finalSnapshot: {
          snapshotId: 'snapshot-1',
          title: 'Leave Apply',
          url: 'https://oa.example.com/leave',
          generatedAt: new Date().toISOString(),
          regions: [],
          forms: [],
          tables: [],
          dialogs: [],
          importantTexts: ['提交成功', '审批中'],
          interactiveElements: [],
          structuredText: '申请已提交，审批中',
        },
        executedSteps: [{
          index: 0,
          type: 'click',
          selector: '#submit',
          status: 'executed',
          snapshotId: 'snapshot-1',
        }],
        warnings: [],
        extractedValues: {
          submissionId: 'OA-12345',
          message: '提交成功',
        },
        artifactRefs: [{
          id: 'snapshot-1',
          kind: 'page_snapshot',
          summary: 'initial',
        }],
      }),
    };
    const service = new VisionDeliveryService(runtime as any);

    const result = await service.submit({
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      taskId: 'task-1',
      context: {
        path: 'vision',
        action: 'submit',
        authConfig: {},
        ticket: {
          jumpUrl: 'https://oa.example.com/portal',
          metadata: { source: 'template' },
        },
        runtime: {
          executorMode: 'browser',
          browserProvider: 'playwright',
        },
        observation: {
          startContext: 'portal_home',
          templateBundleRef: 'artifact://vision/1',
          ocrReady: true,
          snapshotMode: 'structured-text',
        },
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          executionModes: {
            submit: ['vision'],
            queryStatus: ['vision'],
          },
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
            actions: {
              submit: {
                steps: [{
                  type: 'click',
                  selector: '#submit',
                }],
              },
            },
          },
        },
      },
      formData: {
        reason: 'Annual leave',
      },
      attachments: [],
      idempotencyKey: 'idem-1',
    });

    expect(runtime.run).toHaveBeenCalledTimes(1);
    expect(result.submitResult.success).toBe(true);
    expect(result.submitResult.submissionId).toBe('OA-12345');
    expect(result.submitResult.metadata).toMatchObject({
      deliveryPath: 'vision',
      finalSnapshotId: 'snapshot-1',
      observation: {
        startContext: 'portal_home',
        templateBundleRef: 'artifact://vision/1',
        ocrReady: true,
      },
    });
    expect(result.packet.agentType).toBe('vision');
    expect(result.packet.evidence.artifactRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'snapshot-1',
        kind: 'page_snapshot',
      }),
    ]));
  });

  it('fails submit when the final page only indicates save-to-draft behavior', async () => {
    const runtime = {
      run: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'vision-session-2',
        provider: 'playwright',
        requestedProvider: 'playwright',
        snapshots: [],
        finalSnapshot: {
          snapshotId: 'snapshot-2',
          title: 'Leave Apply',
          url: 'https://oa.example.com/leave',
          generatedAt: new Date().toISOString(),
          regions: [],
          forms: [],
          tables: [],
          dialogs: [],
          importantTexts: ['已成功保存至待发列表'],
          interactiveElements: [],
          structuredText: '已成功保存至待发列表',
        },
        executedSteps: [{
          index: 0,
          type: 'click',
          selector: '#save',
          status: 'executed',
          snapshotId: 'snapshot-2',
        }],
        warnings: [],
        extractedValues: {
          message: '已成功保存至待发列表',
        },
        artifactRefs: [],
      }),
    };
    const service = new VisionDeliveryService(runtime as any);

    const result = await service.submit({
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      taskId: 'task-2',
      context: {
        path: 'vision',
        action: 'submit',
        authConfig: {},
        ticket: {
          jumpUrl: 'https://oa.example.com/portal',
          metadata: { source: 'template' },
        },
        runtime: {
          executorMode: 'browser',
          browserProvider: 'playwright',
        },
        observation: {
          startContext: 'portal_home',
          templateBundleRef: 'artifact://vision/2',
          ocrReady: true,
          snapshotMode: 'structured-text',
        },
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          executionModes: {
            submit: ['vision'],
            queryStatus: ['vision'],
          },
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
            actions: {
              submit: {
                steps: [{
                  type: 'click',
                  selector: '#save',
                }],
                successAssert: {
                  type: 'text',
                  value: '已成功保存至待发列表',
                },
              },
            },
          },
        },
      },
      formData: {
        reason: 'Annual leave',
      },
      attachments: [],
      idempotencyKey: 'idem-2',
    });

    expect(result.submitResult.success).toBe(false);
    expect(result.submitResult.submissionId).toBeUndefined();
    expect(result.submitResult.errorMessage).toContain('未真正送审');
    expect(result.submitResult.metadata).toMatchObject({
      submitConfirmation: expect.objectContaining({
        confirmed: false,
        matchedDraftSignal: true,
      }),
    });
  });
});
