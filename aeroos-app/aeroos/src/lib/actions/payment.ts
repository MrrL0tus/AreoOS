'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { withTenant, audit } from '@/lib/db';
import { paymentSchema } from '@/lib/validation/payment';
import type { PaymentFormState } from '@/lib/validation/payment';
import type { ZodError } from 'zod';

function zodErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function recordPayment(
  contractId: string,
  paymentId: string,
  _prev: PaymentFormState,
  formData: FormData
): Promise<PaymentFormState> {
  let session;
  try {
    session = await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof UnauthorizedError) return { errors: {}, formError: 'Session requise' };
    if (e instanceof ForbiddenError) return { errors: {}, formError: e.message };
    throw e;
  }

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error) };
  }
  const data = parsed.data;

  const result = await withTenant(session.tenantId, async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, contractId, deletedAt: null },
    });
    if (!payment) return { ok: false as const, reason: 'not_found' as const };

    // Un paiement déjà marqué reçu ne peut pas être corrigé silencieusement
    // — la justification (notes) est obligatoire pour tracer la correction.
    if (payment.status === 'RECEIVED' && !data.notes) {
      return { ok: false as const, reason: 'notes_required' as const };
    }

    const newStatus = data.amountReceived >= Number(payment.amountDue) ? 'RECEIVED' : 'PARTIAL';

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        amountReceived: data.amountReceived,
        receivedDate: data.receivedDate,
        status: newStatus,
        notes: data.notes ?? payment.notes,
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return { errors: {}, formError: 'Paiement introuvable' };
    }
    return {
      errors: { notes: 'Justification requise pour corriger un paiement déjà reçu' },
    };
  }

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'UPDATE',
    resourceType: 'Payment',
    resourceId: paymentId,
    result: 'SUCCESS',
  });

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath('/contracts');
  revalidatePath('/portfolio');

  return { errors: {}, success: true };
}
