export const IDENTITY_SCOPE_VALUES = ['teacher', 'student', 'both'] as const;

export type IdentityScope = (typeof IDENTITY_SCOPE_VALUES)[number];
export type IdentityType = Exclude<IdentityScope, 'both'>;

export function normalizeIdentityType(value: unknown): IdentityType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'teacher' || normalized === 'student'
    ? normalized
    : undefined;
}

export function normalizeIdentityScope(value: unknown): IdentityScope {
  if (typeof value !== 'string') {
    return 'both';
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'teacher' || normalized === 'student' || normalized === 'both'
    ? normalized
    : 'both';
}

export function isIdentityScopeAllowed(scope: unknown, identityType: unknown): boolean {
  const normalizedScope = normalizeIdentityScope(scope);
  if (normalizedScope === 'both') {
    return true;
  }

  return normalizeIdentityType(identityType) === normalizedScope;
}

export function resolveAllowedIdentityScopes(identityType: unknown): IdentityScope[] {
  const normalizedIdentityType = normalizeIdentityType(identityType);
  if (!normalizedIdentityType) {
    return ['both'];
  }

  return ['both', normalizedIdentityType];
}
