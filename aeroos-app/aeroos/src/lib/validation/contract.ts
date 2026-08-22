import { z } from 'zod';
import { ContractStatus } from '@prisma/client';

function emptyToUndefined(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? undefined : v;
}

const optionalText = () => z.preprocess(emptyToUndefined, z.string().trim().optional());

const optionalDecimal = (message: string) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number({ invalid_type_error: message }).min(0, message).optional()
  );

const requiredDate = (message: string) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.date({ required_error: message, invalid_type_error: message })
  );

const optionalDate = () =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.date({ invalid_type_error: 'Date invalide' }).optional()
  );

export const contractSchema = z
  .object({
    reference: z.string().trim().min(1, 'Référence requise').max(50, 'Référence trop longue'),
    aircraftId: z.string().trim().min(1, 'Actif requis'),
    lesseeId: z.string().trim().min(1, 'Locataire requis'),
    lessorName: z.string().trim().min(1, 'Bailleur requis'),
    startDate: requiredDate('Date de début requise'),
    endDate: requiredDate('Date de fin requise'),
    signedDate: optionalDate(),
    deliveryDate: optionalDate(),
    currency: z.string().trim().min(1, 'Devise requise').max(3, 'Code devise invalide'),
    monthlyRent: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number({ required_error: 'Loyer mensuel requis', invalid_type_error: 'Loyer invalide' })
        .positive('Le loyer doit être positif')
    ),
    securityDeposit: optionalDecimal('Dépôt de garantie invalide'),
    escalationClause: optionalText(),
    mrEngineLeft: optionalDecimal('MR moteur gauche invalide'),
    mrEngineRight: optionalDecimal('MR moteur droit invalide'),
    mrApu: optionalDecimal('MR APU invalide'),
    mrLandingGear: optionalDecimal('MR train d\'atterrissage invalide'),
    mrAirframe: optionalDecimal('MR cellule invalide'),
    governingLaw: optionalText(),
    jurisdiction: optionalText(),
    hasPurchaseOption: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
    hasExtensionOption: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
    hasEarlyTermination: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
    returnConditions: optionalText(),
    status: z.nativeEnum(ContractStatus, {
      errorMap: () => ({ message: 'Statut invalide' }),
    }),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'La date de fin doit être postérieure à la date de début',
    path: ['endDate'],
  });

export type ContractFormValues = z.infer<typeof contractSchema>;

// Défini ici plutôt que dans lib/actions/contract.ts : un fichier 'use
// server' ne peut exporter que des fonctions async.
export interface ContractFormState {
  errors: Record<string, string>;
  formError?: string;
  values?: Record<string, string>;
}

export const emptyContractFormState: ContractFormState = { errors: {} };
