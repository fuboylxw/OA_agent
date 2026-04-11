export function getPublicAuthMode() {
  return 'oauth2';
}

export function isOauth2AuthMode() {
  return true;
}

export function getOauthProviderName() {
  const configured = (process.env.NEXT_PUBLIC_AUTH_PROVIDER_NAME || '').trim();
  return configured || '统一认证';
}
