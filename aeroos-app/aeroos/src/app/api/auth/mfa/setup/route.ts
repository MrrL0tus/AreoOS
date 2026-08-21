import { NextResponse } from 'next/server';
import { requireSession, UnauthorizedError } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { generateSecret, buildOtpauthUrl, buildQrCodeDataUrl } from '@/lib/mfa';

/**
 * Démarre (ou redémarre) l'activation du MFA : génère un nouveau secret,
 * le persiste (mfaEnabled reste false tant que /verify n'a pas confirmé
 * un code), et retourne le QR code à scanner.
 */
export async function POST() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const secret = generateSecret();
  const otpauthUrl = buildOtpauthUrl(secret, session.email);
  const qrCodeDataUrl = await buildQrCodeDataUrl(otpauthUrl);

  await withTenant(session.tenantId, (tx) =>
    tx.user.update({
      where: { id: session.userId },
      data: { mfaSecret: secret, mfaEnabled: false },
    })
  );

  return NextResponse.json({ secret, otpauthUrl, qrCodeDataUrl });
}
