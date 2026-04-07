function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

export function getBrowserApiBaseUrl() {
  const configured = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeBaseUrl(window.location.origin);
  }

  return '';
}

export function withBrowserApiBase(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = getBrowserApiBaseUrl();
  return `${base}${path}`;
}
