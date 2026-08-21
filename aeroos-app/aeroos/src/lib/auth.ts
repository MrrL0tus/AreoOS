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
import { withTenant, audit, asSystem } from './db';
import { verifyToken as verifyTotpToken, matchRecoveryCode } from './mfa';
import { checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit } from './ratelimit';
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
  mfaRequired?: boolean;
  challengeToken?: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

interface MfaChallengePayload {
  userId: string;
  tenantId: string;
  purpose: 'mfa_challenge';
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Connexion
// ─────────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
): Promise<LoginResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const ip = meta.ipAddress ?? 'unknown';

  // Message d'erreur identique dans tous les cas :
  // ne jamais révéler si un compte existe
  const GENERIC_ERROR = 'Identifiants invalides';

  // Vérifié avant toute recherche base : le comptage des échecs ne doit
  // pas révéler l'existence d'un compte, donc il s'applique de la même
  // façon qu'un e-mail corresponde ou non à un utilisateur réel.
  const rateLimit = checkLoginRateLimit(normalizedEmail, ip);
  if (rateLimit.blocked) {
    // Audit uniquement si on peut résoudre un tenant pour cet e-mail —
    // comme pour le cas "compte inexistant" ci-dessous, on ne peut pas
    // écrire d'entrée d'audit sans tenantId.
    const maybeUser = await asSystem(
      `login: vérification du rate-limit pour ${normalizedEmail}`,
      (client) =>
        client.user.findFirst({
          where: { email: normalizedEmail, deletedAt: null },
          select: { id: true, tenantId: true, email: true },
        })
    );
    if (maybeUser) {
      await audit({
        tenantId: maybeUser.tenantId,
        userId: maybeUser.id,
        userEmail: maybeUser.email,
        action: 'LOGIN',
        resourceType: 'User',
        resourceId: maybeUser.id,
        result: 'DENIED',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: 'rate_limited' },
      });
    }
    return {
      success: false,
      rateLimited: true,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      error: 'Trop de tentatives — réessayez plus tard',
    };
  }

  // Recherche hors RLS : on ne connaît pas encore le tenant
  const user = await asSystem(
    `login: recherche de l'utilisateur ${normalizedEmail} avant connaissance du tenant`,
    (client) =>
      client.user.findFirst({
        where: { email: normalizedEmail, isActive: true, deletedAt: null },
        include: { tenant: { select: { id: true, name: true, isActive: true } } },
      })
  );

  if (!user) {
    // Hash factice pour égaliser le temps de réponse (anti-timing attack)
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinv');
    recordFailedLogin(normalizedEmail, ip);
    return { success: false, error: GENERIC_ERROR };
  }

  if (!user.tenant.isActive) {
    return { success: false, error: 'Compte organisation désactivé' };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    recordFailedLogin(normalizedEmail, ip);
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

  // Mot de passe valide : la tentative de force brute est résolue, on
  // remet le compteur à zéro même si le MFA reste à valider.
  resetLoginRateLimit(normalizedEmail, ip);

  // Mot de passe valide : si le MFA est actif, on ne crée pas encore la
  // session — un second facteur est requis (cf. completeMfaLogin ci-dessous).
  if (user.mfaEnabled) {
    const challengeToken = await new SignJWT({
      userId: user.id,
      tenantId: user.tenantId,
      purpose: 'mfa_challenge',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .setIssuer('aeroos')
      .sign(getSecret());

    return { success: false, mfaRequired: true, challengeToken };
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

  await withTenant(user.tenantId, (tx) =>
    tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
  );

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

/**
 * Deuxième étape de la connexion lorsque le MFA est actif : valide le
 * code TOTP (ou un code de récupération à usage unique) et le
 * challengeToken émis par login(), puis crée la session.
 */
export async function completeMfaLogin(
  challengeToken: string,
  code: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
): Promise<LoginResult> {
  const GENERIC_ERROR = 'Code invalide';

  let payload: MfaChallengePayload;
  try {
    const verified = await jwtVerify(challengeToken, getSecret(), {
      issuer: 'aeroos',
    });
    payload = verified.payload as unknown as MfaChallengePayload;
    if (payload.purpose !== 'mfa_challenge') throw new Error('mauvais type de jeton');
  } catch {
    return { success: false, error: 'Session de connexion expirée, recommencez' };
  }

  const user = await withTenant(payload.tenantId, (tx) =>
    tx.user.findFirst({
      where: { id: payload.userId, isActive: true, deletedAt: null },
    })
  );

  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return { success: false, error: GENERIC_ERROR };
  }

  let usedRecoveryCode = false;
  let validCode = verifyTotpToken(user.mfaSecret, code);

  if (!validCode) {
    const matchIndex = await matchRecoveryCode(code, user.mfaRecoveryCodes);
    if (matchIndex !== null) {
      validCode = true;
      usedRecoveryCode = true;
      const remaining = user.mfaRecoveryCodes.filter((_, i) => i !== matchIndex);
      await withTenant(payload.tenantId, (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { mfaRecoveryCodes: remaining },
        })
      );
    }
  }

  if (!validCode) {
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
      metadata: { reason: 'invalid_mfa_code' },
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

  await withTenant(user.tenantId, (tx) =>
    tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
  );

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
    metadata: usedRecoveryCode ? { recoveryCodeUsed: true } : undefined,
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
