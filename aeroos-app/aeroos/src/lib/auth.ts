/**
 * AeroOS — Authentification et session
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sessions JWT stockées en cookie httpOnly.
 *
 * Le token porte tenantId et userId : c'est la source du contexte
 * tenant utilisé par withTenant(). Un token forgé ou expiré ne donne
 * accès à rien — et même avec un tenantId valide, le RLS Postgres
 * limite l'accès aux seules données de ce tenant.
 *
 * ⚠️  MFA : le schéma le supporte (User.mfaEnabled) mais le flux TOTP
 * n'est pas implémenté dans ce squelette. C'est un prérequis avant
 * toute mise en production (cf. Cahier de conformité §2.2).
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma, audit } from './db';
import type { UserRole } from '@prisma/client';

const COOKIE_NAME = 'aeroos_session';

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET manquant ou trop court (min 32 caractères). ' +
      'Générez-en un : openssl rand -base64 32'
    );
  }
  return new TextEncoder().encode(secret);
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SessionPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  session?: SessionPayload;
}

// ─────────────────────────────────────────────────────────────────
// Connexion
// ─────────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
): Promise<LoginResult> {
  // Recherche hors RLS : on ne connaît pas encore le tenant
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim(), isActive: true, deletedAt: null },
    include: { tenant: { select: { id: true, name: true, isActive: true } } },
  });

  // Message d'erreur identique dans tous les cas :
  // ne jamais révéler si un compte existe
  const GENERIC_ERROR = 'Identifiants invalides';

  if (!user) {
    // Hash factice pour égaliser le temps de réponse (anti-timing attack)
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinv');
    return { success: false, error: GENERIC_ERROR };
  }

  if (!user.tenant.isActive) {
    return { success: false, error: 'Compte organisation désactivé' };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    await audit({
      tenantId: user.tenantId,
      userId: user.id,
      userEmail: user.email,
      action: 'LOGIN',
      resourceType: 'User',
      resourceId: user.id,
      result: 'DENIED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason: 'invalid_password' },
    });
    return { success: false, error: GENERIC_ERROR };
  }

  const session: SessionPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  };

  await createSessionCookie(session);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await audit({
    tenantId: user.tenantId,
    userId: user.id,
    userEmail: user.email,
    action: 'LOGIN',
    resourceType: 'User',
    resourceId: user.id,
    result: 'SUCCESS',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { success: true, session };
}

export async function logout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await audit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: 'LOGOUT',
      resourceType: 'User',
      resourceId: session.userId,
    });
  }
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// ─────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────

async function createSessionCookie(payload: SessionPayload): Promise<void> {
  const hours = Number(process.env.AUTH_SESSION_HOURS ?? 8);

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .setIssuer('aeroos')
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: hours * 3600,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: 'aeroos',
    });

    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Récupère la session ou lève une erreur.
 * À utiliser dans les Server Components et Route Handlers protégés.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError('Session requise');
  }
  return session;
}

/**
 * Vérifie que l'utilisateur a au moins le rôle demandé.
 * Hiérarchie : ADMIN > MANAGER > ANALYST > VIEWER
 */
export async function requireRole(minimum: UserRole): Promise<SessionPayload> {
  const session = await requireSession();

  const hierarchy: Record<UserRole, number> = {
    ADMIN: 4,
    MANAGER: 3,
    ANALYST: 2,
    VIEWER: 1,
  };

  if (hierarchy[session.role] < hierarchy[minimum]) {
    throw new ForbiddenError(
      `Rôle ${minimum} requis (vous avez ${session.role})`
    );
  }

  return session;
}

// ─────────────────────────────────────────────────────────────────
// Erreurs
// ─────────────────────────────────────────────────────────────────

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Non authentifié') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = 'Accès refusé') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ─────────────────────────────────────────────────────────────────
// Utilitaires mot de passe
// ─────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

/**
 * Politique de mot de passe (cf. checklist conformité S1)
 */
export function validatePassword(pwd: string): { ok: boolean; error?: string } {
  if (pwd.length < 12) {
    return { ok: false, error: 'Minimum 12 caractères' };
  }
  if (!/[A-Z]/.test(pwd)) {
    return { ok: false, error: 'Au moins une majuscule requise' };
  }
  if (!/[a-z]/.test(pwd)) {
    return { ok: false, error: 'Au moins une minuscule requise' };
  }
  if (!/[0-9]/.test(pwd)) {
    return { ok: false, error: 'Au moins un chiffre requis' };
  }
  return { ok: true };
}
