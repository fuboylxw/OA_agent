import { ForbiddenException } from '@nestjs/common';
import {
  ADMIN_ONLY_ROLES,
  FLOW_MANAGER_ROLES,
  hasAnyRole,
  requireRoles,
} from './access-role.util';

describe('access-role util', () => {
  it('matches user roles against allowed roles', () => {
    expect(hasAnyRole(['user'], FLOW_MANAGER_ROLES)).toBe(false);
    expect(hasAnyRole(['flow_manager'], FLOW_MANAGER_ROLES)).toBe(true);
    expect(hasAnyRole(['admin'], ADMIN_ONLY_ROLES)).toBe(true);
  });

  it('throws when required roles are missing', () => {
    expect(() => requireRoles(['user'], ADMIN_ONLY_ROLES, 'only admin')).toThrow(
      ForbiddenException,
    );
    expect(() => requireRoles(['user'], ADMIN_ONLY_ROLES, 'only admin')).toThrow('only admin');
  });

  it('allows access when any required role is present', () => {
    expect(() => requireRoles(['flow_manager'], FLOW_MANAGER_ROLES)).not.toThrow();
    expect(() => requireRoles(['admin'], ADMIN_ONLY_ROLES)).not.toThrow();
  });
});
