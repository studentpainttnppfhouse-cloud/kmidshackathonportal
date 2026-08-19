import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cheap routing gate.
 *
 * Middleware runs on the edge runtime, where the Node crypto and Supabase
 * calls needed to resolve a session token are not available. So this layer
 * only answers "is there a device cookie at all" and bounces anonymous
 * requests to the sign-in screen.
 *
 * The real check — account status, suspension, ban — happens in
 * src/app/(app)/layout.tsx, which is a server component and therefore also
 * runs on every request to an app route. And underneath both of them, RLS
 * refuses anything a suspended or banned account tries to read or write, so
 * neither of these layers is what actually holds the line.
 */
const SESSION_COOKIE = 'hs_device';

const PUBLIC_PREFIXES = [
  '/signin',
  '/blocked',
  '/f/', // public form submission pages
  '/api/health',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    // Come back here once they are in.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
