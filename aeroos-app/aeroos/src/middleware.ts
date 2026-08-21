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

// /api/auth/mfa/verify : accessible sans cookie de session, car c'est
// justement l'étape qui authentifie l'utilisateur lors du challenge MFA
// (elle vérifie elle-même un challengeToken à courte durée de vie).
// Le cas "confirmation d'activation" du même endpoint vérifie sa propre
// session via getSession() côté handler.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/mfa/verify'];
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
