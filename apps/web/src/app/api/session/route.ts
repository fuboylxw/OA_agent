import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    sessionToken?: string;
    sessionExpiresAt?: string;
  } | null;

  const sessionToken = body?.sessionToken?.trim() || '';
  const sessionExpiresAt = body?.sessionExpiresAt?.trim() || '';
  const expires = sessionExpiresAt ? new Date(sessionExpiresAt) : null;

  if (!sessionToken || !expires || Number.isNaN(expires.getTime())) {
    return NextResponse.json(
      { message: 'Invalid session payload' },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: 'auth_session',
    value: encodeURIComponent(sessionToken),
    expires,
    sameSite: 'lax',
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: 'auth_session',
    value: '',
    expires: new Date(0),
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
