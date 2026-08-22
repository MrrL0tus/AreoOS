'use server';

import { redirect } from 'next/navigation';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { aircraftSchema } from '@/lib/validation/aircraft';
import type { AircraftFormValues, AircraftFormState } from '@/lib/validation/aircraft';
import type { ZodError } from 'zod';

function rawValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function zodErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

function toCreateData(data: AircraftFormValues) {
  return {
    msn: data.msn,
    registration: data.registration ?? null,
    manufacturer: data.manufacturer,
    model: data.model,
    variant: data.variant ?? null,
    yearBuilt: data.yearBuilt,
    status: data.status,
    totalHours: data.totalHours ?? 0,
    totalCycles: data.totalCycles ?? 0,
    hoursQuality: 'DECLARED' as const,
    cabinConfig: data.cabinConfig ?? null,
    seatCount: data.seatCount ?? null,
    mtowKg: data.mtowKg ?? null,
    cofaExpiryDate: data.cofaExpiryDate ?? null,
    insuranceExpiryDate: data.insuranceExpiryDate ?? null,
  };
}

export async function createAircraft(
  _prev: AircraftFormState,
  formData: FormData
): Promise<AircraftFormState> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { errors: {}, formError: 'Session requise' };
    if (e instanceof ForbiddenError) return { errors: {}, formError: e.message };
    throw e;
  }

  const values = rawValues(formData);
  const parsed = aircraftSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error), values };
  }
  const data = parsed.data;

  const result = await withTenant(session.tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: session.tenantId },
      select: { maxAssets: true },
    });
    const activeCount = await tx.aircraft.count({ where: { deletedAt: null } });
    if (activeCount >= tenant.maxAssets) {
      return { ok: false as const, reason: 'quota' as const, max: tenant.maxAssets };
    }

    // MSN unique par tenant, y compris parmi les actifs supprimés
    // (suppression logique uniquement — cf. contrainte @@unique en base).
    const duplicate = await tx.aircraft.findFirst({ where: { msn: data.msn } });
    if (duplicate) {
      return { ok: false as const, reason: 'duplicate_msn' as const };
    }

    const created = await tx.aircraft.create({
      data: { tenantId: session.tenantId, ...toCreateData(data) },
    });

    await tx.assetEvent.create({
      data: {
        tenantId: session.tenantId,
        aircraftId: created.id,
        eventType: 'CREATION',
        eventDate: new Date(),
        title: 'Actif ajouté au registre',
        createdById: session.userId,
      },
    });

    return { ok: true as const, id: created.id };
  });

  if (!result.ok) {
    if (result.reason === 'quota') {
      return {
        errors: {},
        formError: `Quota d'actifs atteint (${result.max} maximum pour ce tenant)`,
        values,
      };
    }
    return { errors: { msn: 'Ce MSN existe déjà pour ce tenant' }, values };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'CREATE',
    resourceType: 'Aircraft',
    resourceId: result.id,
    result: 'SUCCESS',
  });

  redirect(`/assets/${result.id}`);
}

export async function updateAircraft(
  aircraftId: string,
  _prev: AircraftFormState,
  formData: FormData
): Promise<AircraftFormState> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { errors: {}, formError: 'Session requise' };
    if (e instanceof ForbiddenError) return { errors: {}, formError: e.message };
    throw e;
  }

  const values = rawValues(formData);
  const parsed = aircraftSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error), values };
  }
  const data = parsed.data;

  const result = await withTenant(session.tenantId, async (tx) => {
    const existing = await tx.aircraft.findFirst({
      where: { id: aircraftId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return { ok: false as const, reason: 'not_found' as const };

    const duplicate = await tx.aircraft.findFirst({
      where: { msn: data.msn, id: { not: aircraftId } },
    });
    if (duplicate) return { ok: false as const, reason: 'duplicate_msn' as const };

    await tx.aircraft.update({
      where: { id: aircraftId },
      data: toCreateData(data),
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return { errors: {}, formError: 'Actif introuvable', values };
    }
    return { errors: { msn: 'Ce MSN existe déjà pour ce tenant' }, values };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'UPDATE',
    resourceType: 'Aircraft',
    resourceId: aircraftId,
    result: 'SUCCESS',
  });

  redirect(`/assets/${aircraftId}`);
}
