import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { RequestAuthService } from '../common/request-auth.service';

describe('PermissionController', () => {
  let controller: PermissionController;
  let permissionService: { check: jest.Mock };
  let requestAuth: { resolveUser: jest.Mock };

  beforeEach(() => {
    permissionService = {
      check: jest.fn().mockResolvedValue({ allowed: true }),
    };
    requestAuth = {
      resolveUser: jest.fn(),
    };

    controller = new PermissionController(
      permissionService as unknown as PermissionService,
      requestAuth as unknown as RequestAuthService,
    );
  });

  it('uses resolved auth identity instead of raw request body values', async () => {
    requestAuth.resolveUser.mockResolvedValue({
      tenantId: 'tenant-session',
      userId: 'user-session',
      roles: ['user'],
      source: 'session',
    });

    await controller.check({} as any, {
      tenantId: 'tenant-body',
      userId: 'user-body',
      processCode: 'expense_flow',
      action: 'submit',
      context: { amount: 100 },
    });

    expect(requestAuth.resolveUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-body',
        userId: 'user-body',
        requireUser: true,
      }),
    );
    expect(permissionService.check).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-session',
        userId: 'user-session',
        processCode: 'expense_flow',
        action: 'submit',
        context: { amount: 100 },
      }),
    );
  });
});
