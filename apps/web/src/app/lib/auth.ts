import 'server-only';
import { cookies, headers } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

let cachedWorkspaceEnv: Record<string, string> | null = null;

type AuthSessionClaims = {
  ver: 'v1';
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  tenantId: string;
  iat: number;
  exp: number;
};

function getServerEnv(name: string) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim()) {
    return runtimeValue;
  }

  const workspaceValue = getWorkspaceEnv()[name];
  return workspaceValue?.trim() || '';
}

function getWorkspaceEnv() {
  if (cachedWorkspaceEnv) {
    return cachedWorkspaceEnv;
  }

  const merged: Record<string, string> = {};
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env.local'),
    resolve(process.cwd(), '../../.env'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(readFileSync(filePath, 'utf8')));
  }

  cachedWorkspaceEnv = merged;
  return merged;
}

function parseEnvFile(input: string) {
  const values: Record<string, string> = {};

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function resolveSessionSecret() {
  return getServerEnv('AUTH_SESSION_SECRET') || getServerEnv('JWT_SECRET');
}

async function resolveServerApiUrl() {
  const configured = (
    getServerEnv('NEXT_PUBLIC_API_URL')
    || getServerEnv('PUBLIC_API_BASE_URL')
    || getServerEnv('API_BASE_URL')
  ).trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host');
  if (host) {
    const proto = headerStore.get('x-forwarded-proto')
      || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  return 'http://localhost:3001';
}

function verifyServerSessionToken(token: string, secret: string): AuthSessionClaims | null {
  if (!token || !secret) {
    return null;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthSessionClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.ver !== 'v1' || !claims.userId || !claims.tenantId || !claims.username) {
      return null;
    }
    if (!Array.isArray(claims.roles) || typeof claims.exp !== 'number' || claims.exp <= now) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export async function getServerAuth() {
  const cookieStore = await cookies();
  const authSession = cookieStore.get('auth_session')?.value;
  const sessionSecret = resolveSessionSecret();

  if (authSession && sessionSecret) {
    const sessionToken = decodeURIComponent(authSession);
    const verified = verifyServerSessionToken(sessionToken, sessionSecret);
    if (verified) {
      return {
        userId: verified.userId,
        tenantId: verified.tenantId,
        roles: verified.roles,
        displayName: verified.displayName,
        username: verified.username,
        sessionToken,
      };
    }
  }

  return {
    userId: '',
    tenantId: '',
    roles: [] as string[],
    displayName: '',
    username: '',
    sessionToken: '',
  };
}

export function getApiUrl() {
  return getServerEnv('NEXT_PUBLIC_API_URL') || getServerEnv('PUBLIC_API_BASE_URL') || getServerEnv('API_BASE_URL');
}

export async function fetchApi(path: string, init?: RequestInit) {
  const { sessionToken } = await getServerAuth();
  return fetchApiWithToken(path, sessionToken, init);
}

export async function fetchApiWithToken(path: string, sessionToken: string, init?: RequestInit) {
  if (!sessionToken) {
    throw new Error('Missing auth session');
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  const apiUrl = await resolveServerApiUrl();

  return fetch(path.startsWith('http') ? path : `${apiUrl}${path}`, {
    ...init,
    headers,
  });
}
