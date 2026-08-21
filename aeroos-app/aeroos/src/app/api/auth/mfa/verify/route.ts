import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeMfaLogin, getSession } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { verifyToken, generateRecoveryCodes } from '@/lib/mfa';

const loginChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
});

const activationSchema = z.object({
  code: z.string().min(1),
});

/**
 * Deux usages selon le corps de la requête :
 *  - { challengeToken, code } : deuxième étape de connexion (non authentifié)
 *  - { code }                 : confirmation d'activation (session requise)
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const challenge = loginChallengeSchema.safeParse(body);
  if (challenge.success) {
    const forwarded = request.headers.get('x-forwarded-for');
    const result = await completeMfaLogin(
      challenge.data.challengeToken,
      challenge.data.code,
      {
        ipAddress: forwarded?.split(',')[0]?.trim(),
        userAgent: request.headers.get('user-agent') ?? undefined,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Confirmation d'activation ──────────────────────────────────
  const activation = activationSchema.safeParse(body);
  if (!activation.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Session requise' }, { status: 401 });
  }

  const user = await withTenant(session.tenantId, (tx) =>
    tx.user.findFirst({ where: { id: session.userId, deletedAt: null } })
  );

  if (!user?.mfaSecret) {
    return NextResponse.json(
      { error: "Aucune activation MFA en cours — recommencez depuis /settings/mfa" },
      { status: 400 }
    );
  }

  if (!verifyToken(user.mfaSecret, activation.data.code)) {
    return NextResponse.json({ error: 'Code invalide' }, { status: 400 });
  }

  const { plain, hashed } = await generateRecoveryCodes();

  await withTenant(session.tenantId, (tx) =>
    tx.user.update({
      where: { id: session.userId },
      data: { mfaEnabled: true, mfaRecoveryCodes: hashed },
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
    metadata: { field: 'mfaEnabled', value: true },
  });

  return NextResponse.json({ ok: true, recoveryCodes: plain });
}
