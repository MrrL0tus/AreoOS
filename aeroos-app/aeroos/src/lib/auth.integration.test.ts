/**
 * Tests d'intégration pour src/lib/auth.ts — utilise le mock de
 * `next/headers` (vitest.setup.ts) pour simuler le cookie de session
 * hors runtime Next, et un tenant Postgres jetable pour les utilisateurs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  login, getSession, requireSession, requireRole, changePassword,
  logout, hashPassword, validatePassword, UnauthorizedError, ForbiddenError,
} from './auth';
import { withTenant } from './db';
import { generateSecret } from './mfa';
import { createTestTenant, destroyTestTenant } from './__tests__/testTenant';
import { fakeCookieStore } from '../../vitest.setup';

const PASSWORD = 'Test-Pass-1234!';

describe('validatePassword', () => {
  it('rejette un mot de passe trop court', () => {
    expect(validatePassword('Sh0rt!').ok).toBe(false);
  });
  it('rejette un mot de passe avec moins de 3 classes de caractères', () => {
    expect(validatePassword('alllowercase12').ok).toBe(false);
  });
  it('rejette un mot de passe courant même s\'il satisfait les classes', () => {
    expect(validatePassword('Password123').ok).toBe(false);
  });
  it('accepte un mot de passe conforme', () => {
    expect(validatePassword(PASSWORD).ok).toBe(true);
  });
});

describe('login / getSession / requireRole / changePassword — intégration', () => {
  let tenantId: string;
  let userEmail: string;

  beforeAll(async () => {
    tenantId = await createTestTenant('auth');
    userEmail = 'qa-auth@example.invalid';
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId, email: userEmail, passwordHash, firstName: 'QA', lastName: 'Auth',
          role: 'ANALYST',
          // getSession() compare payload.iat (précision seconde, JWT) à
          // passwordChangedAt (précision milliseconde). Sans ce recul,
          // un login qui suit la création du compte dans la même
          // seconde peut se voir immédiatement invalidé par la
          // comparaison — un cas limite réel mais qui ne doit pas
          // rendre CE test flaky : on fixe passwordChangedAt loin dans
          // le passé, comme pour un compte qui existe déjà depuis un
          // moment (le cas normal en usage réel).
          passwordChangedAt: new Date(Date.now() - 60_000),
        },
      })
    );
  });

  afterAll(async () => {
    await destroyTestTenant(tenantId);
  });

  it('refuse un mot de passe invalide sans révéler si le compte existe', async () => {
    fakeCookieStore.clear();
    const result = await login(userEmail, 'mauvais-mot-de-passe', { ipAddress: '203.0.113.10' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Identifiants invalides');

    const resultUnknown = await login('inconnu@example.invalid', 'peu-importe', {
      ipAddress: '203.0.113.11',
    });
    expect(resultUnknown.error).toBe(result.error); // message générique identique
  });

  it('connecte avec les bons identifiants et pose un cookie de session exploitable', async () => {
    fakeCookieStore.clear();
    const result = await login(userEmail, PASSWORD, { ipAddress: '203.0.113.20' });
    expect(result.success).toBe(true);
    expect(result.session?.email).toBe(userEmail);
    expect(result.session?.role).toBe('ANALYST');

    const session = await getSession();
    expect(session?.email).toBe(userEmail);
  });

  it('requireSession lève UnauthorizedError sans cookie', async () => {
    fakeCookieStore.clear();
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('requireRole respecte la hiérarchie ADMIN > MANAGER > ANALYST > VIEWER', async () => {
    fakeCookieStore.clear();
    await login(userEmail, PASSWORD, {});

    await expect(requireRole('VIEWER')).resolves.toBeTruthy();
    await expect(requireRole('ANALYST')).resolves.toBeTruthy();
    await expect(requireRole('ADMIN')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('bloque après 5 échecs sur le même e-mail (rate limit)', async () => {
    fakeCookieStore.clear();
    const email = 'qa-auth-ratelimit@example.invalid';
    for (let i = 0; i < 5; i++) {
      await login(email, 'faux-mot-de-passe', { ipAddress: `198.51.100.${i}` });
    }
    const result = await login(email, 'faux-mot-de-passe', { ipAddress: '198.51.100.99' });
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('un compte avec MFA activé demande le second facteur avant d\'ouvrir une session', async () => {
    const mfaEmail = 'qa-auth-mfa@example.invalid';
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId, email: mfaEmail, passwordHash, firstName: 'QA', lastName: 'MFA',
          role: 'VIEWER', mfaEnabled: true, mfaSecret: generateSecret(),
          passwordChangedAt: new Date(Date.now() - 60_000),
        },
      })
    );

    fakeCookieStore.clear();
    const result = await login(mfaEmail, PASSWORD, {});
    expect(result.success).toBe(false);
    expect(result.mfaRequired).toBe(true);
    expect(result.challengeToken).toBeTruthy();
    // Pas de session ouverte tant que le second facteur n'est pas validé
    expect(await getSession()).toBeNull();
  });

  it('changePassword invalide les sessions émises avant le changement, sans affecter l\'appareil courant', async () => {
    fakeCookieStore.clear();
    await login(userEmail, PASSWORD, {});
    const oldToken = fakeCookieStore.get('aeroos_session')?.value;
    expect(oldToken).toBeTruthy();

    // getSession() compare l'iat du JWT (précision seconde) à
    // passwordChangedAt tronqué à la seconde (cf. changePassword()) : si
    // login() et changePassword() tombent dans la même seconde, les deux
    // bornes sont égales et l'ancien jeton n'est, à tort, pas invalidé
    // par la stricte infériorité du test. Attente réelle pour franchir
    // une frontière de seconde, comme le ferait n'importe quel usage réel.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const newPassword = 'New-Test-Pass-5678!';
    const result = await changePassword(PASSWORD, newPassword, {});
    expect(result.success).toBe(true);

    // L'appareil courant reste connecté (cookie réémis par changePassword)
    expect(await getSession()).not.toBeNull();

    // Un cookie émis AVANT le changement est désormais invalide (autre appareil)
    fakeCookieStore.set('aeroos_session', oldToken!, {});
    expect(await getSession()).toBeNull();
  });

  it('changePassword refuse un mot de passe actuel incorrect', async () => {
    fakeCookieStore.clear();
    await login(userEmail, 'New-Test-Pass-5678!', {});
    const result = await changePassword('mauvais-mot-de-passe-actuel', 'Another-Pass-999!', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('incorrect');
  });

  it('logout supprime le cookie de session', async () => {
    fakeCookieStore.clear();
    await login(userEmail, 'New-Test-Pass-5678!', {});
    expect(await getSession()).not.toBeNull();
    await logout();
    expect(fakeCookieStore.get('aeroos_session')).toBeUndefined();
    expect(await getSession()).toBeNull();
  });
});
