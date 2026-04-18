import { ForbiddenException } from '@nestjs/common';

export const ADMIN_ONLY_ROLES = ['admin'] as const;
export const FLOW_MANAGER_ROLES = ['admin', 'flow_manager'] as const;
export const AUDIT_VIEW_ROLES = ['admin', 'flow_manager', 'auditor'] as const;

export function hasAnyRole(
  userRoles: readonly string[] | null | undefined,
  allowedRoles: readonly string[],
) {
  if (!allowedRoles.length) {
    return true;
  }

  const normalizedRoles = Array.isArray(userRoles) ? userRoles : [];
  return allowedRoles.some((role) => normalizedRoles.includes(role));
}

export function requireRoles(
  userRoles: readonly string[] | null | undefined,
  allowedRoles: readonly string[],
  message = '当前用户无权访问该接口',
) {
  if (!hasAnyRole(userRoles, allowedRoles)) {
    throw new ForbiddenException(message);
  }
}
