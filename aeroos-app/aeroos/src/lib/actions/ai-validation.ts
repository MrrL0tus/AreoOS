'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { contractSchema } from '@/lib/validation/contract';
import type { ContractFormState } from '@/lib/validation/contract';
import { buildMonthlyPayments } from '@/lib/contract-activation';
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

function toDateKey(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Valide une extraction IA en attente : crée (ou met à jour, si le
 * document source est déjà lié à un contrat) le LeaseContract avec les
 * valeurs — potentiellement corrigées — soumises par l'humain. Les
 * écarts entre valeur extraite et valeur validée sont conservés dans
 * AiExtraction.corrections (matière première pour améliorer le prompt).
 */
export async function validateExtraction(
  extractionId: string,
  _prev: ContractFormState,
  formData: FormData
): Promise<ContractFormState> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { errors: {}, formError: 'Session requise' };
    if (e instanceof ForbiddenError) return { errors: {}, formError: e.message };
    throw e;
  }

  const values = rawValues(formData);
  const parsed = contractSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error), values };
  }
  const data = parsed.data;

  const result = await withTenant(session.tenantId, async (tx) => {
    const extraction = await tx.aiExtraction.findFirst({
      where: { id: extractionId, deletedAt: null, status: 'PENDING' },
      include: { document: { select: { id: true, contractId: true } } },
    });
    if (!extraction) return { ok: false as const, reason: 'not_found' as const };

    const lessee = await tx.operator.findFirst({
      where: { id: data.lesseeId, deletedAt: null },
      select: { sanctionsStatus: true },
    });
    if (!lessee) return { ok: false as const, reason: 'lessee_not_found' as const };
    if (lessee.sanctionsStatus === 'BLOCKED') {
      return { ok: false as const, reason: 'sanctions_blocked' as const };
    }

    const existingContractId = extraction.document.contractId;

    if (!existingContractId) {
      const duplicateRef = await tx.leaseContract.findFirst({
        where: { reference: data.reference },
      });
      if (duplicateRef) return { ok: false as const, reason: 'duplicate_reference' as const };
    }

    if (data.status === 'ACTIVE') {
      const overlapping = await tx.leaseContract.findFirst({
        where: {
          aircraftId: data.aircraftId,
          status: 'ACTIVE',
          deletedAt: null,
          ...(existingContractId ? { id: { not: existingContractId } } : {}),
          startDate: { lte: data.endDate },
          endDate: { gte: data.startDate },
        },
        select: { reference: true },
      });
      if (overlapping) {
        return {
          ok: false as const,
          reason: 'overlap' as const,
          reference: overlapping.reference,
        };
      }
    }

    const contractData = {
      reference: data.reference,
      aircraftId: data.aircraftId,
      lessorName: data.lessorName,
      lesseeId: data.lesseeId,
      startDate: data.startDate,
      endDate: data.endDate,
      signedDate: data.signedDate ?? null,
      deliveryDate: data.deliveryDate ?? null,
      currency: data.currency,
      monthlyRent: data.monthlyRent,
      securityDeposit: data.securityDeposit ?? null,
      escalationClause: data.escalationClause ?? null,
      mrEngineLeft: data.mrEngineLeft ?? null,
      mrEngineRight: data.mrEngineRight ?? null,
      mrApu: data.mrApu ?? null,
      mrLandingGear: data.mrLandingGear ?? null,
      mrAirframe: data.mrAirframe ?? null,
      governingLaw: data.governingLaw ?? null,
      jurisdiction: data.jurisdiction ?? null,
      hasPurchaseOption: data.hasPurchaseOption,
      hasExtensionOption: data.hasExtensionOption,
      hasEarlyTermination: data.hasEarlyTermination,
      returnConditions: data.returnConditions ?? null,
      status: data.status,
      extractedByAi: true,
      aiExtractionId: extraction.id,
    };

    let contractId: string;
    if (existingContractId) {
      await tx.leaseContract.update({ where: { id: existingContractId }, data: contractData });
      contractId = existingContractId;
    } else {
      const created = await tx.leaseContract.create({
        data: { tenantId: session.tenantId, ...contractData },
      });
      contractId = created.id;
      await tx.document.update({
        where: { id: extraction.document.id },
        data: { contractId },
      });
    }

    if (data.status === 'ACTIVE') {
      await tx.aircraft.update({
        where: { id: data.aircraftId },
        data: { status: 'ON_LEASE', currentOperatorId: data.lesseeId },
      });

      const existingPaymentCount = await tx.payment.count({
        where: { contractId, deletedAt: null },
      });
      if (existingPaymentCount === 0) {
        const payments = buildMonthlyPayments(data);
        await tx.payment.createMany({
          data: payments.map((p) => ({
            tenantId: session.tenantId,
            contractId,
            periodLabel: p.periodLabel,
            dueDate: p.dueDate,
            amountDue: p.amountDue,
            currency: p.currency,
            status: 'SCHEDULED' as const,
          })),
        });
      }
    }

    // Corrections : écarts entre la valeur proposée par l'IA et la
    // valeur validée par l'humain — matière première pour améliorer le
    // prompt (cf. lib/ai/extract-contract.ts).
    const originalFields = extraction.extractedFields as Record<
      string,
      { value: unknown } | undefined
    >;
    const validatedValues: Record<string, unknown> = {
      lessorName: data.lessorName,
      startDate: toDateKey(data.startDate),
      endDate: toDateKey(data.endDate),
      deliveryDate: toDateKey(data.deliveryDate),
      signedDate: toDateKey(data.signedDate),
      monthlyRent: data.monthlyRent,
      currency: data.currency,
      escalationClause: data.escalationClause ?? null,
      securityDeposit: data.securityDeposit ?? null,
      mrEngine: data.mrEngineLeft ?? null,
      mrApu: data.mrApu ?? null,
      governingLaw: data.governingLaw ?? null,
      hasPurchaseOption: data.hasPurchaseOption,
    };
    const corrections: Record<string, { original: unknown; corrected: unknown }> = {};
    for (const [key, correctedValue] of Object.entries(validatedValues)) {
      const original = originalFields[key]?.value ?? null;
      if (JSON.stringify(original) !== JSON.stringify(correctedValue)) {
        corrections[key] = { original, corrected: correctedValue };
      }
    }

    await tx.aiExtraction.update({
      where: { id: extraction.id },
      data: {
        status: 'VALIDATED',
        validatedById: session.userId,
        validatedAt: new Date(),
        corrections: Object.keys(corrections).length > 0 ? (corrections as never) : undefined,
      },
    });

    return { ok: true as const, contractId };
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return { errors: {}, formError: 'Extraction introuvable ou déjà traitée' };
    }
    if (result.reason === 'lessee_not_found') {
      return { errors: { lesseeId: 'Locataire introuvable' }, values };
    }
    if (result.reason === 'sanctions_blocked') {
      return {
        errors: {},
        formError:
          'Ce locataire est bloqué pour cause de sanctions — la validation est refusée.',
        values,
      };
    }
    if (result.reason === 'duplicate_reference') {
      return { errors: { reference: 'Cette référence existe déjà pour ce tenant' }, values };
    }
    return {
      errors: {},
      formError: `Chevauchement avec le contrat actif ${result.reference} sur cet actif`,
      values,
    };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'AI_VALIDATE',
    resourceType: 'LeaseContract',
    resourceId: result.contractId,
    result: 'SUCCESS',
    metadata: { extractionId, validatedBy: session.userId },
  });

  redirect(`/contracts/${result.contractId}`);
}

/**
 * Rejette une extraction en attente : aucune écriture sur LeaseContract,
 * juste le statut REJECTED + la trace du validateur.
 */
export async function rejectExtraction(
  extractionId: string
): Promise<{ ok: boolean; error?: string }> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: e.message };
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }

  const updated = await withTenant(session.tenantId, (tx) =>
    tx.aiExtraction.updateMany({
      where: { id: extractionId, deletedAt: null, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        validatedById: session.userId,
        validatedAt: new Date(),
      },
    })
  );

  if (updated.count === 0) {
    return { ok: false, error: 'Extraction introuvable ou déjà traitée' };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'AI_VALIDATE',
    resourceType: 'AiExtraction',
    resourceId: extractionId,
    result: 'SUCCESS',
    metadata: { decision: 'REJECTED' },
  });

  revalidatePath('/ai');
  return { ok: true };
}
