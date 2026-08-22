import { NextResponse } from 'next/server';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { extractContractFields } from '@/lib/ai/extract-contract';

export async function POST(request: Request) {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const documentId = typeof (body as { documentId?: unknown })?.documentId === 'string'
    ? (body as { documentId: string }).documentId
    : null;
  if (!documentId) {
    return NextResponse.json({ error: 'documentId requis' }, { status: 400 });
  }

  const document = await withTenant(session.tenantId, (tx) =>
    tx.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true, extractedText: true, title: true },
    })
  );
  if (!document) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
  }
  if (!document.extractedText) {
    return NextResponse.json(
      { error: "Aucun texte extrait pour ce document (PDF illisible ou non-PDF)" },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await extractContractFields(document.extractedText);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Échec de l'extraction IA" },
      { status: 502 }
    );
  }

  // Statut PENDING systématique (défaut du modèle) : aucune donnée
  // n'atteint LeaseContract sans validation humaine explicite — cf.
  // lib/actions/ai-validation.ts.
  const extraction = await withTenant(session.tenantId, (tx) =>
    tx.aiExtraction.create({
      data: {
        tenantId: session.tenantId,
        documentId: document.id,
        modelName: result.modelName,
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion,
        extractedFields: result.fields as never,
        overallConfidence: result.overallConfidence,
      },
    })
  );

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'AI_EXTRACT',
    resourceType: 'AiExtraction',
    resourceId: extraction.id,
    result: 'SUCCESS',
    metadata: { documentId: document.id, overallConfidence: result.overallConfidence },
  });

  return NextResponse.json({ ok: true, id: extraction.id });
}
