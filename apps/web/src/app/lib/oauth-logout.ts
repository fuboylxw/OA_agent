export const OAUTH_LOGOUT_WAIT_MS = 800;
export const OAUTH_TOP_LEVEL_LOGOUT_WAIT_MS = 2500;

export async function triggerOauthLogout(logoutUrl: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.src = logoutUrl;
  } catch {
    // ignore
  }

  try {
    await fetch(logoutUrl, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    });
    return true;
  } catch {
    return false;
  }
}
