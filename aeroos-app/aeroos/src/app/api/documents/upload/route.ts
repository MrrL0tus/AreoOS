import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { getStorage, buildStorageKey, MAX_UPLOAD_BYTES, ALLOWED_MIME_TYPES } from '@/lib/storage';
import { extractPdfText } from '@/lib/pdf-extract';
import { DocumentCategory } from '@prisma/client';

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

  const formData = await request.formData();
  const file = formData.get('file');
  const title = String(formData.get('title') ?? '').trim();
  const categoryRaw = String(formData.get('category') ?? '');
  const subcategory = String(formData.get('subcategory') ?? '').trim() || null;
  const aircraftId = String(formData.get('aircraftId') ?? '').trim();
  const contractId = String(formData.get('contractId') ?? '').trim() || null;
  const issueDateRaw = String(formData.get('issueDate') ?? '').trim();
  const expiryDateRaw = String(formData.get('expiryDate') ?? '').trim();
  const parentDocId = String(formData.get('parentDocId') ?? '').trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier reçu' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'Titre requis' }, { status: 400 });
  }
  if (!aircraftId) {
    return NextResponse.json({ error: 'Actif requis' }, { status: 400 });
  }
  if (!(Object.values(DocumentCategory) as string[]).includes(categoryRaw)) {
    return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo)` },
      { status: 400 }
    );
  }
  if (!(file.type in ALLOWED_MIME_TYPES)) {
    return NextResponse.json(
      { error: 'Type de fichier non autorisé (pdf, jpg, png, docx, xlsx uniquement)' },
      { status: 400 }
    );
  }

  const category = categoryRaw as DocumentCategory;
  const issueDate = issueDateRaw ? new Date(issueDateRaw) : null;
  const expiryDate = expiryDateRaw ? new Date(expiryDateRaw) : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const storage = getStorage();
  // Best-effort : un PDF illisible ne doit jamais faire échouer l'upload.
  const extractedText = file.type === 'application/pdf' ? await extractPdfText(buffer) : null;

  const result = await withTenant(session.tenantId, async (tx) => {
    const aircraft = await tx.aircraft.findFirst({
      where: { id: aircraftId, deletedAt: null },
      select: { id: true },
    });
    if (!aircraft) return { ok: false as const, reason: 'aircraft_not_found' as const };

    let version = 1;
    if (parentDocId) {
      const parent = await tx.document.findFirst({
        where: { id: parentDocId, deletedAt: null, aircraftId },
        select: { version: true },
      });
      if (!parent) return { ok: false as const, reason: 'parent_not_found' as const };
      version = parent.version + 1;
    }

    const documentId = randomUUID();
    const storageKey = buildStorageKey(session.tenantId, aircraftId, documentId, version);

    await storage.put(storageKey, buffer, file.type);

    const document = await tx.document.create({
      data: {
        id: documentId,
        tenantId: session.tenantId,
        title,
        filename: file.name,
        category,
        subcategory,
        aircraftId,
        contractId,
        storageKey,
        mimeType: file.type,
        sizeBytes: file.size,
        extractedText,
        version,
        issueDate,
        expiryDate,
        parentDocId,
      },
    });

    return { ok: true as const, id: document.id };
  });

  if (!result.ok) {
    if (result.reason === 'aircraft_not_found') {
      return NextResponse.json({ error: 'Actif introuvable' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Document original introuvable' }, { status: 400 });
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'CREATE',
    resourceType: 'Document',
    resourceId: result.id,
    result: 'SUCCESS',
  });

  return NextResponse.json({ ok: true, id: result.id });
}
