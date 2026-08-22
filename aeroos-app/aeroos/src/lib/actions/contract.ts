'use server';

import { redirect } from 'next/navigation';
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

export async function createContract(
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
    const lessee = await tx.operator.findFirst({
      where: { id: data.lesseeId, deletedAt: null },
      select: { sanctionsStatus: true },
    });
    if (!lessee) return { ok: false as const, reason: 'lessee_not_found' as const };

    // Blocage sanctions (conformité §5.4) : aucun contrat, quel que soit
    // son statut, ne doit pouvoir être enregistré avec une contrepartie
    // bloquée.
    if (lessee.sanctionsStatus === 'BLOCKED') {
      return { ok: false as const, reason: 'sanctions_blocked' as const };
    }

    const duplicateRef = await tx.leaseContract.findFirst({
      where: { reference: data.reference },
    });
    if (duplicateRef) return { ok: false as const, reason: 'duplicate_reference' as const };

    if (data.status === 'ACTIVE') {
      const overlapping = await tx.leaseContract.findFirst({
        where: {
          aircraftId: data.aircraftId,
          status: 'ACTIVE',
          deletedAt: null,
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

    const created = await tx.leaseContract.create({
      data: {
        tenantId: session.tenantId,
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
      },
    });

    if (data.status === 'ACTIVE') {
      await tx.aircraft.update({
        where: { id: data.aircraftId },
        data: { status: 'ON_LEASE', currentOperatorId: data.lesseeId },
      });

      const payments = buildMonthlyPayments(data);
      await tx.payment.createMany({
        data: payments.map((p) => ({
          tenantId: session.tenantId,
          contractId: created.id,
          periodLabel: p.periodLabel,
          dueDate: p.dueDate,
          amountDue: p.amountDue,
          currency: p.currency,
          status: 'SCHEDULED' as const,
        })),
      });
    }

    return {
      ok: true as const,
      id: created.id,
      flagged: lessee.sanctionsStatus === 'FLAGGED',
    };
  });

  if (!result.ok) {
    if (result.reason === 'lessee_not_found') {
      return { errors: { lesseeId: 'Locataire introuvable' }, values };
    }
    if (result.reason === 'sanctions_blocked') {
      return {
        errors: {},
        formError:
          'Ce locataire est bloqué pour cause de sanctions — la création du contrat est refusée.',
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
    action: 'CREATE',
    resourceType: 'LeaseContract',
    resourceId: result.id,
    result: 'SUCCESS',
    metadata: result.flagged ? { lesseeSanctionsStatus: 'FLAGGED' } : undefined,
  });

  redirect(`/contracts/${result.id}`);
}
