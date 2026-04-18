const HOME_QUICK_ACTIONS: Array<{ href: string; roles?: readonly string[] }> = [
  { href: '/chat' },
  { href: '/submissions' },
  { href: '/process-library', roles: ['admin', 'flow_manager'] },
  { href: '/bootstrap', roles: ['admin'] },
  { href: '/connectors', roles: ['admin'] },
];

const ROUTE_ROLE_RULES: Array<{ path: string; roles?: string[] }> = [
  { path: '/processes', roles: ['admin', 'flow_manager'] },
  { path: '/process-library', roles: ['admin', 'flow_manager'] },
  { path: '/bootstrap', roles: ['admin'] },
  { path: '/connectors', roles: ['admin'] },
  { path: '/api-upload', roles: ['admin'] },
  { path: '/auth-bindings', roles: ['admin'] },
];

export function getRoleDisplayName(userRoles: string[]) {
  if (userRoles.includes('admin')) {
    return '超级管理员';
  }

  if (userRoles.includes('flow_manager')) {
    return '管理员';
  }

  return '普通用户';
}

export function hasRequiredRole(userRoles: string[], allowedRoles?: readonly string[]) {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  return allowedRoles.some((role) => userRoles.includes(role));
}

export function getHomeQuickActionHrefs(userRoles: string[]) {
  return HOME_QUICK_ACTIONS
    .filter((item) => hasRequiredRole(userRoles, item.roles))
    .map((item) => item.href);
}

export function isRouteAllowed(pathname: string, userRoles: string[]) {
  const match = ROUTE_ROLE_RULES.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );

  return hasRequiredRole(userRoles, match?.roles);
}
