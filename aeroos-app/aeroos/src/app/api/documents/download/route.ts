import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { verifyLocalSignature } from '@/lib/storage/local';

/**
 * Sert les liens signés émis par le driver de stockage local (cf.
 * lib/storage/local.ts). Le driver S3 pointe directement vers une URL
 * S3 présignée — cette route n'est jamais sollicitée dans ce cas.
 *
 * Deux vérifications indépendantes avant de servir le fichier :
 * signature + expiration (5 min), ET appartenance au tenant de la
 * session en cours (extraite du premier segment de la clé de stockage,
 * puis reconfirmée par la recherche RLS du document ci-dessous).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const expiresRaw = url.searchParams.get('expires');
  const sig = url.searchParams.get('sig');

  if (!key || !expiresRaw || !sig) {
    return NextResponse.json({ error: 'Lien de téléchargement invalide' }, { status: 400 });
  }
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || !verifyLocalSignature(key, expires, sig)) {
    return NextResponse.json({ error: 'Lien expiré ou invalide' }, { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Session requise' }, { status: 401 });
  }

  const tenantIdFromKey = key.split('/')[0];
  if (tenantIdFromKey !== session.tenantId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  const document = await withTenant(session.tenantId, (tx) =>
    tx.document.findFirst({
      where: { storageKey: key, deletedAt: null },
      select: { id: true, filename: true, mimeType: true },
    })
  );
  if (!document) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
  }

  const buffer = await getStorage().get(key);

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'EXPORT',
    resourceType: 'Document',
    resourceId: document.id,
    result: 'SUCCESS',
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename="${document.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
