/**
 * Middleware — protection des routes applicatives.
 *
 * Vérifie uniquement la PRÉSENCE du cookie de session : la validation
 * cryptographique se fait côté serveur dans requireSession(), car le
 * middleware s'exécute dans le runtime Edge où l'on veut rester léger.
 *
 * Défense en profondeur : même si ce middleware était contourné, chaque
 * page appelle requireSession() et chaque requête base passe par
 * withTenant() + RLS Postgres.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];
const COOKIE_NAME = 'aeroos_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(COOKIE_NAME);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
};
