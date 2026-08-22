import { NextResponse } from 'next/server';
import { requireRole, ForbiddenError, UnauthorizedError, type SessionPayload } from '@/lib/auth';
import { audit } from '@/lib/db';
import { exportUserData, eraseUserData } from '@/lib/gdpr';

/**
 * Export et effacement RGPD d'un utilisateur du tenant (T4.2, articles
 * 15 et 17). Réservé ADMIN — ces opérations touchent les données
 * personnelles d'un tiers, pas les siennes propres.
 *
 * GET    /api/admin/export-user-data?userId=…            → export JSON
 * DELETE /api/admin/export-user-data?userId=…&reason=…    → anonymisation
 */

function authErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  let session: SessionPayload;
  try {
    session = await requireRole('ADMIN');
  } catch (e) {
    const res = authErrorResponse(e);
    if (res) return res;
    throw e;
  }

  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Paramètre userId requis' }, { status: 400 });
  }

  const data = await exportUserData(session.tenantId, userId);
  if (!data) {
    return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'EXPORT',
    resourceType: 'User',
    resourceId: userId,
    result: 'SUCCESS',
    metadata: { gdpr: 'article15' },
  });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="export-rgpd-${userId}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(request: Request) {
  let session: SessionPayload;
  try {
    session = await requireRole('ADMIN');
  } catch (e) {
    const res = authErrorResponse(e);
    if (res) return res;
    throw e;
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const reason = url.searchParams.get('reason')?.trim();
  if (!userId) {
    return NextResponse.json({ error: 'Paramètre userId requis' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json(
      { error: 'Paramètre reason requis (justification de la demande RGPD)' },
      { status: 400 }
    );
  }

  const result = await eraseUserData(session.tenantId, userId, {
    adminUserId: session.userId,
    adminEmail: session.email,
    reason,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Utilisateur déjà anonymisé' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
