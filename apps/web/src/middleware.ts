import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isPublicRoute(pathname: string) {
  return pathname === '/login'
    || pathname.startsWith('/login/')
    || pathname === '/logout'
    || pathname.startsWith('/logout/');
}

function normalizeReturnTo(value?: string | null) {
  const normalized = (value || '').trim();
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }

  return normalized;
}

function buildExternalUrl(request: NextRequest, pathname: string) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  const protocol = (forwardedProto || request.nextUrl.protocol.replace(':', '') || 'http').trim();
  return new URL(`${protocol}://${host}${pathname}`);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get('auth_session')?.value?.trim());
  const loginRoute = isPublicRoute(pathname);

  if (!hasSession && !loginRoute) {
    const loginUrl = buildExternalUrl(request, '/login');
    const returnTo = normalizeReturnTo(`${pathname}${search}`);
    if (returnTo !== '/') {
      loginUrl.searchParams.set('returnTo', returnTo);
    }

    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === '/login') {
    const targetUrl = buildExternalUrl(
      request,
      normalizeReturnTo(request.nextUrl.searchParams.get('returnTo')),
    );
    return NextResponse.redirect(targetUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|vendor).*)',
  ],
};
