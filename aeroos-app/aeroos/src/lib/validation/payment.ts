import { z } from 'zod';

function emptyToUndefined(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? undefined : v;
}

export const paymentSchema = z.object({
  amountReceived: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({
        required_error: 'Montant reçu requis',
        invalid_type_error: 'Montant invalide',
      })
      .positive('Le montant doit être positif')
  ),
  receivedDate: z.preprocess(
    emptyToUndefined,
    z.coerce.date({
      required_error: 'Date de réception requise',
      invalid_type_error: 'Date invalide',
    })
  ),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});

export type PaymentFormValues = z.infer<typeof paymentSchema>;

// Défini ici plutôt que dans lib/actions/payment.ts : un fichier 'use
// server' ne peut exporter que des fonctions async.
export interface PaymentFormState {
  errors: Record<string, string>;
  formError?: string;
  // Distingue un état "jamais soumis" d'un état "soumission réussie" —
  // les deux ont sinon la même forme ({ errors: {} }).
  success?: boolean;
}

export const emptyPaymentFormState: PaymentFormState = { errors: {} };
