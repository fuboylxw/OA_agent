function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function ensureLeadingSlash(value: string) {
  if (!value) {
    return '';
  }

  return value.startsWith('/') ? value : `/${value}`;
}

export function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

export function resolveApiOrigin() {
  return trimTrailingSlashes(
    readEnv('API_URL', 'API_BASE_URL', 'PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_API_URL')
    || 'http://localhost:3001',
  );
}

export function resolveApiPrefix() {
  return ensureLeadingSlash(readEnv('API_PREFIX') || '/api/v1');
}

export function resolveApiBaseUrl() {
  const origin = resolveApiOrigin();
  const prefix = trimTrailingSlashes(resolveApiPrefix());

  if (!prefix) {
    return origin;
  }

  return origin.endsWith(prefix) ? origin : `${origin}${prefix}`;
}
