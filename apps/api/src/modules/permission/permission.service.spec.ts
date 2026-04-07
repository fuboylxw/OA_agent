import { PermissionService } from './permission.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import axios from 'axios';

jest.mock('axios');

describe('PermissionService', () => {
  let service: PermissionService;
  let prisma: {
    user: { findFirst: jest.Mock };
    permissionPolicy: { findMany: jest.Mock };
    processTemplate: { findFirst: jest.Mock };
  };
  let auditService: { createLog: jest.Mock };
  let adapterRuntimeService: { resolveAuthConfig: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_OA_PERMISSION_CHECK;

    prisma = {
      user: { findFirst: jest.fn() },
      permissionPolicy: { findMany: jest.fn() },
      processTemplate: { findFirst: jest.fn() },
    };
    auditService = {
      createLog: jest.fn(),
    };
    adapterRuntimeService = {
      resolveAuthConfig: jest.fn(),
    };

    service = new PermissionService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      adapterRuntimeService as unknown as AdapterRuntimeService,
    );

    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      roles: ['user'],
      status: 'active',
    });
    prisma.permissionPolicy.findMany.mockResolvedValue([]);
  });

  it('skips OA permission check when no connector template is found', async () => {
    prisma.processTemplate.findFirst.mockResolvedValue(null);

    const result = await service.check({
      tenantId: 'tenant-1',
      userId: 'user-1',
      processCode: 'travel_expense',
      action: 'submit',
      traceId: 'trace-1',
    });

    expect(result.allowed).toBe(true);
    expect(result.oaCheck.reason).toContain('已跳过');
  });

  it('calls configured OA permission endpoint when available', async () => {
    prisma.processTemplate.findFirst.mockResolvedValue({
      connector: {
        baseUrl: 'https://oa.example.com',
        authType: 'apikey',
        authConfig: {
          oaPermissionCheck: {
            enabled: true,
            endpoint: '/permission/check',
            method: 'POST',
            requestTemplate: {
              uid: '{{userId}}',
              process: '{{processCode}}',
              action: '{{action}}',
            },
            allowedPath: 'data.allowed',
            reasonPath: 'data.reason',
          },
        },
        capability: {
          supportsRealtimePerm: true,
        },
      },
    });
    adapterRuntimeService.resolveAuthConfig.mockResolvedValue({
      headerName: 'x-token',
      token: 'secret-token',
    });
    (axios as unknown as jest.Mock).mockResolvedValue({
      data: {
        data: {
          allowed: true,
          reason: 'OA permission granted',
        },
      },
    });

    const result = await service.check({
      tenantId: 'tenant-1',
      userId: 'user-1',
      processCode: 'travel_expense',
      action: 'submit',
      traceId: 'trace-2',
    });

    expect(result.allowed).toBe(true);
    expect(result.oaCheck.reason).toBe('OA permission granted');
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/permission/check',
      headers: expect.objectContaining({
        'x-token': 'secret-token',
      }),
      data: {
        uid: 'user-1',
        process: 'travel_expense',
        action: 'submit',
      },
    }));
  });

  it('denies when realtime permission is required but not configured', async () => {
    process.env.REQUIRE_OA_PERMISSION_CHECK = 'true';
    prisma.processTemplate.findFirst.mockResolvedValue({
      connector: {
        baseUrl: 'https://oa.example.com',
        authType: 'apikey',
        authConfig: {},
        capability: {
          supportsRealtimePerm: true,
        },
      },
    });

    const result = await service.check({
      tenantId: 'tenant-1',
      userId: 'user-1',
      processCode: 'travel_expense',
      action: 'submit',
      traceId: 'trace-3',
    });

    expect(result.allowed).toBe(false);
    expect(result.oaCheck.reason).toContain('未配置权限校验接口');
  });
});
