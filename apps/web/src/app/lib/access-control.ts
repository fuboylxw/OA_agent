const HOME_QUICK_ACTIONS: Array<{ href: string; roles?: readonly string[] }> = [
  { href: '/chat' },
  { href: '/submissions' },
  { href: '/processes' },
  { href: '/bootstrap', roles: ['admin'] },
];

const ROUTE_ROLE_RULES: Array<{ path: string; roles?: string[] }> = [
  { path: '/bootstrap', roles: ['admin'] },
  { path: '/connectors', roles: ['admin', 'flow_manager'] },
  { path: '/api-upload', roles: ['admin', 'flow_manager'] },
];

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
