export type IdentityScope = 'teacher' | 'student' | 'both';
export type IdentityType = 'teacher' | 'student' | '';

export const IDENTITY_SCOPE_META: Record<IdentityScope, { label: string; badge: string; description: string }> = {
  teacher: {
    label: '老师可用',
    badge: '老师',
    description: '仅教师/教职工身份可见和发起该连接器下的流程。',
  },
  student: {
    label: '学生可用',
    badge: '学生',
    description: '仅学生身份可见和发起该连接器下的流程。',
  },
  both: {
    label: '老师和学生都可用',
    badge: '通用',
    description: '老师和学生都可以使用该连接器下的流程。',
  },
};

export function normalizeIdentityScope(value: unknown): IdentityScope {
  if (value === 'teacher' || value === 'student' || value === 'both') {
    return value;
  }
  return 'both';
}

export function normalizeIdentityType(value: unknown): IdentityType {
  if (value === 'teacher' || value === 'student') {
    return value;
  }
  return '';
}

export function isIdentityScopeAllowed(scope: unknown, identityType: unknown) {
  const normalizedScope = normalizeIdentityScope(scope);
  if (normalizedScope === 'both') {
    return true;
  }

  return normalizeIdentityType(identityType) === normalizedScope;
}
