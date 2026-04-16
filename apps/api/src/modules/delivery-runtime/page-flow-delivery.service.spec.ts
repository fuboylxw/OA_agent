import { PageFlowDeliveryService } from './page-flow-delivery.service';

describe('PageFlowDeliveryService', () => {
  it('uses the internal URL network runtime when networkSubmit is configured', async () => {
    const urlNetworkSubmitService = {
      execute: jest.fn().mockResolvedValue({
        submitResult: {
          success: true,
          submissionId: 'REQ-1001',
          metadata: {
            mode: 'url-network',
          },
        },
        artifactRefs: [],
        summary: 'network ok',
      }),
    };
    const service = new PageFlowDeliveryService(urlNetworkSubmitService as any);

    const result = await service.submit({
      path: 'url',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      taskId: 'task-1',
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {},
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave',
        },
        runtime: {
          networkSubmit: {
            url: 'https://oa.example.com/api/leave/submit',
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
      formData: {
        reason: 'annual leave',
      },
      idempotencyKey: 'idem-1',
    });

    expect(urlNetworkSubmitService.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: expect.objectContaining({
        formData: {
          reason: 'annual leave',
        },
      }),
    }));
    expect(result.submitResult.success).toBe(true);
    expect(result.submitResult.submissionId).toBe('REQ-1001');
    expect(result.packet.success).toBe(true);
  });

  it('falls back to browser executor when no network runtime is configured', async () => {
    const urlNetworkSubmitService = {
      execute: jest.fn(),
    };
    const service = new PageFlowDeliveryService(urlNetworkSubmitService as any);
    const browserExecutor = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        submissionId: 'REQ-BROWSER-1',
        message: 'browser ok',
        snapshots: [],
      }),
    };
    (service as any).browserExecutor = browserExecutor;

    const result = await service.submit({
      path: 'url',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      taskId: 'task-1',
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          sessionCookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave',
        },
        runtime: {
          executorMode: 'browser',
          browserProvider: 'playwright',
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
            actions: {
              submit: {
                steps: [],
              },
            },
          },
        },
      } as any,
      formData: {
        reason: 'annual leave',
      },
      idempotencyKey: 'idem-1',
    });

    expect(urlNetworkSubmitService.execute).not.toHaveBeenCalled();
    expect(browserExecutor.execute).toHaveBeenCalledTimes(1);
    expect(result.submitResult.success).toBe(true);
    expect(result.submitResult.submissionId).toBe('REQ-BROWSER-1');
  });
});
