import { createHmac, timingSafeEqual } from 'crypto';

export interface AuthSessionClaims {
  ver: 'v1';
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  tenantId: string;
  iat: number;
  exp: number;
}

export interface IssueAuthSessionInput {
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  tenantId: string;
}

export function issueAuthSessionToken(
  input: IssueAuthSessionInput,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): { token: string; claims: AuthSessionClaims } {
  const now = Math.floor(Date.now() / 1000);
  const claims: AuthSessionClaims = {
    ver: 'v1',
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    roles: input.roles,
    tenantId: input.tenantId,
    iat: now,
    exp: now + ttlSeconds,
  };

  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = signPayload(payload, secret);
  return {
    token: `${payload}.${signature}`,
    claims,
  };
}

export function verifyAuthSessionToken(token: string, secret: string): AuthSessionClaims | null {
  if (!token || !secret) {
    return null;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as AuthSessionClaims;
    if (claims.ver !== 'v1') {
      return null;
    }
    if (!claims.userId || !claims.tenantId || !claims.username) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      return null;
    }
    if (!Array.isArray(claims.roles)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
