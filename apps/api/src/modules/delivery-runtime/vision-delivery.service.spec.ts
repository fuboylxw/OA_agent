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
          importantTexts: [],
          interactiveElements: [],
          structuredText: '',
        },
        executedSteps: [{
          index: 0,
          type: 'click',
          selector: '#submit',
          status: 'executed',
          snapshotId: 'snapshot-1',
        }],
        warnings: [],
        extractedValues: {},
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
});
