import { DeliveryCapabilityRouter } from './delivery-capability.router';

describe('DeliveryCapabilityRouter', () => {
  it('infers vision as a degraded browser capability when an rpa flow exists', () => {
    const router = new DeliveryCapabilityRouter({} as any);
    const summary = router.resolveForTemplateRecord({
      id: 'template-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      remoteProcessId: 'remote-1',
      processCode: 'leave_apply',
      processName: '请假申请',
      processCategory: 'hr',
      description: null,
      status: 'published',
      falLevel: null,
      version: 1,
      sourceVersion: '1',
      sourceHash: null,
      schema: {},
      rules: null,
      permissions: null,
      uiHints: {
        executionModes: {
          submit: ['api', 'rpa'],
          queryStatus: ['api'],
        },
        rpaDefinition: {
          processCode: 'leave_apply',
          processName: '请假申请',
          platform: {
            entryUrl: 'https://oa.example.com/portal',
          },
          actions: {
            submit: {
              steps: [{ type: 'click', selector: '#submit' }],
            },
          },
        },
      },
      lastSyncedAt: new Date(),
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      supersedesId: null,
      connector: {
        id: 'connector-1',
        tenantId: 'tenant-1',
        name: '示例 OA',
        oaType: 'hybrid',
        oaVendor: null,
        oaVersion: null,
        baseUrl: 'https://oa.example.com',
        authType: 'cookie',
        authConfig: {},
        healthCheckUrl: null,
        oclLevel: 'OCL2',
        falLevel: null,
        status: 'active',
        lastHealthCheck: null,
        syncStrategy: null,
        statusMapping: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as any);

    expect(summary.api.available).toBe(true);
    expect(summary.api.submitEnabled).toBe(true);
    expect(summary.url.available).toBe(true);
    expect(summary.url.health).toBe('healthy');
    expect(summary.vision.available).toBe(true);
    expect(summary.vision.submitEnabled).toBe(true);
    expect(summary.vision.health).toBe('degraded');
    expect(summary.fallbackOrder).toEqual(['api', 'vision', 'url']);
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('api');
  });

  it('infers vision capability when image targets are present', () => {
    const router = new DeliveryCapabilityRouter({} as any);
    const summary = router.resolveForTemplateRecord({
      id: 'template-2',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      remoteProcessId: 'remote-1',
      processCode: 'expense_submit',
      processName: '费用报销',
      processCategory: 'finance',
      description: null,
      status: 'published',
      falLevel: null,
      version: 1,
      sourceVersion: '1',
      sourceHash: null,
      schema: {},
      rules: null,
      permissions: null,
      uiHints: {
        rpaDefinition: {
          processCode: 'expense_submit',
          processName: '费用报销',
          actions: {
            submit: {
              steps: [{
                type: 'click',
                target: {
                  kind: 'image',
                  value: 'submit-button',
                  imageUrl: 'data:image/png;base64,abc',
                },
              }],
            },
          },
        },
        visionTemplateBundleRef: 'artifact://vision-bundle/1',
        visionOcrReady: true,
      },
      lastSyncedAt: new Date(),
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      supersedesId: null,
      connector: null,
    } as any);

    expect(summary.vision.available).toBe(true);
    expect(summary.vision.submitEnabled).toBe(true);
    expect(summary.vision.health).toBe('healthy');
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('vision');
  });

  it('prefers vision before url when both capabilities are available', () => {
    const router = new DeliveryCapabilityRouter({} as any);
    const summary = router.resolveForTemplateRecord({
      id: 'template-3',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      remoteProcessId: 'remote-1',
      processCode: 'leave_apply_vision',
      processName: '璇峰亣鐢宠-瑙嗚璺緞',
      processCategory: 'hr',
      description: null,
      status: 'published',
      falLevel: null,
      version: 1,
      sourceVersion: '1',
      sourceHash: null,
      schema: {},
      rules: null,
      permissions: null,
      uiHints: {
        rpaDefinition: {
          processCode: 'leave_apply_vision',
          processName: '璇峰亣鐢宠-瑙嗚璺緞',
          platform: {
            entryUrl: 'http://localhost:8080/perManaGement/Login.jsp',
          },
          actions: {
            submit: {
              steps: [{
                type: 'click',
                target: {
                  kind: 'image',
                  value: '#submit',
                  label: '鐧诲綍鎸夐挳',
                },
              }],
            },
          },
        },
        visionOcrReady: true,
      },
      lastSyncedAt: new Date(),
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      supersedesId: null,
      connector: null,
    } as any);

    expect(summary.url.available).toBe(true);
    expect(summary.vision.available).toBe(true);
    expect(summary.fallbackOrder).toEqual(['vision', 'url']);
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('vision');
  });
});
