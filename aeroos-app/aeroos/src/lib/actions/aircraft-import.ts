'use server';

import Papa from 'papaparse';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { mapCsvRow, type ColumnMapping } from '@/lib/import/aircraft-csv';
import type { ImportFormState, ImportReportRow } from '@/lib/import/aircraft-csv';

const MAX_ROWS = 2000;

export async function importAircraftCsv(
  _prev: ImportFormState,
  formData: FormData
): Promise<ImportFormState> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { formError: 'Session requise' };
    if (e instanceof ForbiddenError) return { formError: e.message };
    throw e;
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { formError: 'Aucun fichier reçu' };
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(String(formData.get('mapping') ?? '{}'));
  } catch {
    return { formError: 'Correspondance de colonnes invalide' };
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.data.length === 0) {
    return { formError: 'Le fichier ne contient aucune ligne de données' };
  }
  if (parsed.data.length > MAX_ROWS) {
    return { formError: `Trop de lignes (${parsed.data.length}) — maximum ${MAX_ROWS} par import` };
  }

  const report = await withTenant(session.tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: session.tenantId },
      select: { maxAssets: true },
    });

    const existingMsns = new Set(
      (await tx.aircraft.findMany({ select: { msn: true } })).map((a) => a.msn)
    );
    let activeCount = await tx.aircraft.count({ where: { deletedAt: null } });

    let created = 0;
    let skipped = 0;
    const errors: ImportReportRow[] = [];
    const seenInFile = new Set<string>();

    for (let i = 0; i < parsed.data.length; i++) {
      const line = i + 2; // ligne 1 = en-têtes
      const row = parsed.data[i];
      const result = mapCsvRow(row, mapping);

      if (!result.ok) {
        errors.push({ line, reasons: result.errors });
        continue;
      }

      const { data } = result;

      // Idempotence (clé msn + tenant) : déjà en base ou déjà vu plus
      // haut dans ce même fichier → on ignore silencieusement, ce n'est
      // pas une erreur.
      if (existingMsns.has(data.msn) || seenInFile.has(data.msn)) {
        skipped++;
        continue;
      }
      seenInFile.add(data.msn);

      if (activeCount >= tenant.maxAssets) {
        errors.push({ line, reasons: [`Quota d'actifs atteint (${tenant.maxAssets} maximum)`] });
        continue;
      }

      const aircraft = await tx.aircraft.create({
        data: {
          tenantId: session.tenantId,
          msn: data.msn,
          registration: data.registration,
          manufacturer: data.manufacturer,
          model: data.model,
          variant: data.variant,
          yearBuilt: data.yearBuilt,
          status: data.status,
          totalHours: data.totalHours,
          totalCycles: data.totalCycles,
          hoursQuality: 'DECLARED',
          cabinConfig: data.cabinConfig,
          seatCount: data.seatCount,
          mtowKg: data.mtowKg,
        },
      });

      await tx.assetEvent.create({
        data: {
          tenantId: session.tenantId,
          aircraftId: aircraft.id,
          eventType: 'CREATION',
          eventDate: new Date(),
          title: 'Actif ajouté au registre (import CSV)',
          createdById: session.userId,
        },
      });

      await audit({
        tenantId: session.tenantId,
        userId: session.userId,
        userEmail: session.email,
        action: 'CREATE',
        resourceType: 'Aircraft',
        resourceId: aircraft.id,
        result: 'SUCCESS',
        metadata: { source: 'csv_import', line },
      });

      activeCount++;
      created++;
    }

    return { created, skipped, errors };
  });

  return { report };
}
