import { DeliveryCapabilityRouter } from './delivery-capability.router';

describe('DeliveryCapabilityRouter', () => {
  it('infers vision as a degraded browser capability without inferring url from browser steps', () => {
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
    expect(summary.url.available).toBe(false);
    expect(summary.vision.available).toBe(true);
    expect(summary.vision.submitEnabled).toBe(true);
    expect(summary.vision.health).toBe('degraded');
    expect(summary.fallbackOrder).toEqual(['api', 'vision']);
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

  it('does not infer url capability from a browser-only flow definition', () => {
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

    expect(summary.url.available).toBe(false);
    expect(summary.vision.available).toBe(true);
    expect(summary.fallbackOrder).toEqual(['vision']);
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('vision');
  });

  it('treats url network runtime as a submit/query capable url path even without browser submit steps', () => {
    const router = new DeliveryCapabilityRouter({} as any);
    const summary = router.resolveForTemplateRecord({
      id: 'template-4',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      remoteProcessId: 'remote-1',
      processCode: 'leave_apply_url_network',
      processName: '请假申请-URL网络模式',
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
          processCode: 'leave_apply_url_network',
          processName: '请假申请-URL网络模式',
          accessMode: 'direct_link',
          sourceType: 'direct_link',
          platform: {
            jumpUrlTemplate: 'https://oa.example.com/workflow/{processCode}',
          },
          runtime: {
            networkSubmit: {
              url: 'https://oa.example.com/api/workflow/submit',
            },
            networkStatus: {
              url: 'https://oa.example.com/api/workflow/status',
            },
          },
        },
      },
      lastSyncedAt: new Date(),
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      supersedesId: null,
      connector: null,
    } as any);

    expect(summary.url.available).toBe(true);
    expect(summary.url.submitEnabled).toBe(true);
    expect(summary.url.queryEnabled).toBe(true);
    expect(summary.url.executorMode).toBe('http');
    expect(summary.vision.available).toBe(false);
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('url');
  });

  it('prefers runtimeManifest over legacy executionModes when both exist', () => {
    const router = new DeliveryCapabilityRouter({} as any);
    const summary = router.resolveForTemplateRecord({
      id: 'template-5',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      remoteProcessId: 'remote-1',
      processCode: 'manifest_first_flow',
      processName: 'Manifest First Flow',
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
        runtimeManifest: {
          version: 1,
          capabilities: {
            submit: ['url'],
            queryStatus: [],
          },
          definition: {
            processCode: 'manifest_first_flow',
            processName: 'Manifest First Flow',
            accessMode: 'direct_link',
            sourceType: 'direct_link',
            platform: {
              jumpUrlTemplate: 'https://oa.example.com/workflow/manifest_first_flow',
            },
            runtime: {
              networkSubmit: {
                url: 'https://oa.example.com/api/workflow/submit',
              },
            },
          },
        },
        executionModes: {
          submit: ['rpa'],
          queryStatus: ['rpa'],
        },
        rpaDefinition: {
          processCode: 'manifest_first_flow',
          processName: 'Manifest First Flow',
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
      connector: null,
    } as any);

    expect(summary.source).toBe('runtime_manifest');
    expect(summary.url.available).toBe(true);
    expect(summary.vision.available).toBe(false);
    expect(router.selectPrimaryPath(summary, 'submit')).toBe('url');
  });
});
