import { BrowserRpaExecutor } from './browser-rpa-executor';

describe('BrowserRpaExecutor', () => {
  it('uses action result mapping for submit and queryStatus results', async () => {
    const runtime = {
      run: jest.fn()
        .mockResolvedValueOnce({
          success: true,
          provider: 'playwright',
          requestedProvider: 'playwright',
          sessionId: 'session-submit',
          executedSteps: [],
          snapshots: [],
          recoveryAttempts: [],
          extractedValues: {
            submit: {
              business: {
                id: 'LV-20260326-01',
              },
            },
            result: {
              status: 'IN_APPROVAL',
              message: 'submitted ok',
            },
          },
        })
        .mockResolvedValueOnce({
          success: true,
          provider: 'playwright',
          requestedProvider: 'playwright',
          sessionId: 'session-status',
          executedSteps: [],
          snapshots: [],
          recoveryAttempts: [],
          extractedValues: {
            query: {
              currentStatus: 'APPROVED',
            },
            result: {
              message: 'status synced',
            },
          },
        }),
    };

    const executor = new BrowserRpaExecutor(runtime as any);
    const flow = {
      processCode: 'leave_request',
      processName: 'Leave Request',
      actions: {
        submit: {
          steps: [],
          resultMapping: {
            submissionIdPath: 'submit.business.id',
            statusPath: 'result.status',
            messagePath: 'result.message',
          },
        },
        queryStatus: {
          steps: [],
          resultMapping: {
            statusPath: 'query.currentStatus',
            messagePath: 'result.message',
          },
        },
      },
    } as any;

    const submit = await executor.execute({
      action: 'submit',
      flow,
      runtime: {
        executorMode: 'browser',
        browserProvider: 'playwright',
      },
      payload: {
        idempotencyKey: 'req-001',
      },
      ticket: {
        jumpUrl: 'https://oa.example.com/jump/leave',
      },
    });

    expect(submit.success).toBe(true);
    expect(submit.submissionId).toBe('LV-20260326-01');
    expect(submit.status).toBe('IN_APPROVAL');
    expect(submit.message).toBe('submitted ok');

    const status = await executor.execute({
      action: 'queryStatus',
      flow,
      runtime: {
        executorMode: 'browser',
        browserProvider: 'playwright',
      },
      payload: {
        submissionId: 'LV-20260326-01',
      },
      ticket: {
        jumpUrl: 'https://oa.example.com/jump/leave',
      },
    });

    expect(status.success).toBe(true);
    expect(status.status).toBe('APPROVED');
    expect(status.message).toBe('status synced');
    expect(status.timeline).toEqual([
      expect.objectContaining({
        status: 'APPROVED',
        operator: 'browser_rpa_runtime',
      }),
    ]);
  });

  it('does not fake submit success when no real submission evidence is available', async () => {
    const runtime = {
      run: jest.fn().mockResolvedValue({
        success: true,
        provider: 'stub',
        requestedProvider: 'stub',
        sessionId: 'session-1',
        executedSteps: [],
        snapshots: [],
        recoveryAttempts: [],
        extractedValues: {},
      }),
    };

    const executor = new BrowserRpaExecutor(runtime as any);
    const result = await executor.execute({
      action: 'submit',
      flow: {
        processCode: 'expense_submit',
        processName: 'Expense Submit',
        actions: {
          submit: {
            steps: [],
          },
        },
      } as any,
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
      },
      payload: {
        idempotencyKey: 'req-browser-001',
      },
      ticket: {},
    });

    expect(result.success).toBe(false);
    expect(result.submissionId).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.message).toContain('未识别到真实提交成功信号');
  });
});
