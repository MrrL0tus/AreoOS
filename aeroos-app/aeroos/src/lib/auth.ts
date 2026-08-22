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
import { isCommonPassword } from './common-passwords';
import type { UserRole } from '@prisma/client';

const COOKIE_NAME = 'aeroos_session';

// Fenêtre glissante : le cookie expire s'il n'est pas renouvelé (cf.
// renewSession()). Plafond absolu : même renouvelée en continu, une
// session ne dépasse jamais cette durée depuis la connexion initiale
// (cf. T1.4 — évite qu'un cookie volé reste valide indéfiniment).
const SLIDING_SESSION_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS ?? 900);
const ABSOLUTE_SESSION_SECONDS = 12 * 3600;

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
  /** Horodatage (secondes epoch) de la connexion initiale — fixe à
   *  travers les renouvellements, sert de base au plafond absolu. */
  sessionStart: number;
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
      // Jamais l'e-mail dans la raison — asSystem() la journalise
      // (cf. CLAUDE.md règle 6 / conformité §7 D4).
      'login: vérification du rate-limit pour une tentative de connexion',
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
    // Idem : pas d'e-mail dans la raison journalisée.
    "login: recherche d'un utilisateur par e-mail avant connaissance du tenant",
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
    sessionStart: Math.floor(Date.now() / 1000),
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
    sessionStart: Math.floor(Date.now() / 1000),
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
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SLIDING_SESSION_SECONDS}s`)
    .setIssuer('aeroos')
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SLIDING_SESSION_SECONDS,
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

    const session = payload as unknown as SessionPayload;

    // Plafond absolu (T1.4) : même renouvelée à chaque requête, une
    // session ne doit jamais dépasser cette durée depuis la connexion
    // initiale. Un token émis avant l'introduction de sessionStart n'a
    // pas cette réclamation — traité comme expiré, il force une
    // reconnexion propre plutôt que d'échapper au contrôle.
    if (
      typeof session.sessionStart !== 'number' ||
      Date.now() / 1000 - session.sessionStart > ABSOLUTE_SESSION_SECONDS
    ) {
      return null;
    }

    // Un changement de mot de passe doit invalider les sessions émises
    // avant lui, y compris sur d'autres appareils — le token JWT étant
    // sans état, on compare son horodatage d'émission (iat) à la date
    // du dernier changement, connue seulement en base.
    const user = await withTenant(session.tenantId, (tx) =>
      tx.user.findFirst({
        where: { id: session.userId, deletedAt: null },
        select: { passwordChangedAt: true },
      })
    );
    if (!user || !payload.iat || payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      return null;
    }

    return session;
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
 * Renouvelle le cookie de session (fenêtre glissante) si la session en
 * cours est valide — appelé par POST /api/auth/refresh, sur ping du
 * client tant que l'utilisateur est actif. sessionStart est repris tel
 * quel : ça n'étend jamais la session au-delà du plafond absolu, déjà
 * contrôlé dans getSession().
 */
export async function renewSession(): Promise<{ renewed: boolean }> {
  const session = await getSession();
  if (!session) return { renewed: false };
  await createSessionCookie(session);
  return { renewed: true };
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
 * Politique de mot de passe (cf. checklist conformité S1) : 12 caractères
 * minimum, au moins 3 des 4 classes de caractères, refus des mots de
 * passe les plus courants.
 */
export function validatePassword(pwd: string): { ok: boolean; error?: string } {
  if (pwd.length < 12) {
    return { ok: false, error: 'Minimum 12 caractères' };
  }

  const classes = [
    /[A-Z]/.test(pwd),
    /[a-z]/.test(pwd),
    /[0-9]/.test(pwd),
    /[^A-Za-z0-9]/.test(pwd),
  ].filter(Boolean).length;

  if (classes < 3) {
    return {
      ok: false,
      error: 'Au moins 3 catégories requises parmi : majuscules, minuscules, chiffres, symboles',
    };
  }

  if (isCommonPassword(pwd)) {
    return { ok: false, error: 'Ce mot de passe est trop courant' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// Changement de mot de passe
// ─────────────────────────────────────────────────────────────────

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Change le mot de passe de l'utilisateur actuellement connecté.
 * Invalide toutes les sessions existantes (y compris les autres
 * appareils) via passwordChangedAt — cf. getSession(). La session en
 * cours est immédiatement remplacée par un cookie fraîchement émis.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  meta: { ipAddress?: string; userAgent?: string } = {}
): Promise<ChangePasswordResult> {
  const session = await requireSession();

  const user = await withTenant(session.tenantId, (tx) =>
    tx.user.findFirst({
      where: { id: session.userId, deletedAt: null },
    })
  );
  if (!user) {
    return { success: false, error: 'Utilisateur introuvable' };
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    await audit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: session.userId,
      result: 'DENIED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { field: 'passwordHash', reason: 'current_password_invalid' },
    });
    return { success: false, error: 'Mot de passe actuel incorrect' };
  }

  const check = validatePassword(newPassword);
  if (!check.ok) {
    return { success: false, error: check.error };
  }

  const passwordHash = await hashPassword(newPassword);
  // Tronqué à la seconde : le JWT (iat) a une précision à la seconde, et
  // la comparaison dans getSession() doit voir le cookie réémis juste
  // après comme au moins aussi récent que ce changement.
  const passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);

  await withTenant(session.tenantId, (tx) =>
    tx.user.update({
      where: { id: session.userId },
      data: { passwordHash, passwordChangedAt },
    })
  );

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'UPDATE',
    resourceType: 'User',
    resourceId: session.userId,
    result: 'SUCCESS',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { field: 'passwordHash' },
  });

  // Réémet un cookie pour l'appareil courant : sans ça, la vérification
  // passwordChangedAt dans getSession() déconnecterait aussi l'utilisateur
  // qui vient de changer son mot de passe.
  await createSessionCookie(session);

  return { success: true };
}
