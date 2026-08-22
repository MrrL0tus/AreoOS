'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';

/**
 * Enregistre le retour utilisateur (utile / pas utile) sur un résumé IA
 * — signal simple, pas de workflow de validation (contrairement à
 * l'extraction de contrat, un résumé n'écrit rien ailleurs).
 */
export async function submitSummaryFeedback(
  documentId: string,
  useful: boolean
): Promise<{ ok: boolean; error?: string }> {
  let session;
  try {
    session = await requireRole('VIEWER');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: e.message };
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }

  const updated = await withTenant(session.tenantId, (tx) =>
    tx.document.updateMany({
      where: { id: documentId, deletedAt: null, aiSummary: { not: null } },
      data: { aiSummaryFeedback: useful, aiSummaryFeedbackAt: new Date() },
    })
  );

  if (updated.count === 0) {
    return { ok: false, error: 'Document ou résumé introuvable' };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'UPDATE',
    resourceType: 'Document',
    resourceId: documentId,
    result: 'SUCCESS',
    metadata: { field: 'aiSummaryFeedback', value: useful },
  });

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}
