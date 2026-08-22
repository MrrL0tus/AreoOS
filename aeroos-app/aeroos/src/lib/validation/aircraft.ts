import { z } from 'zod';
import { AssetStatus } from '@prisma/client';

const CURRENT_YEAR = new Date().getFullYear();

function emptyToUndefined(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? undefined : v;
}

const optionalText = () => z.preprocess(emptyToUndefined, z.string().trim().optional());

const optionalInt = (message: string) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number({ invalid_type_error: message }).int(message).min(0, message).optional()
  );

const optionalDate = () =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.date({ invalid_type_error: 'Date invalide' }).optional()
  );

export const aircraftSchema = z.object({
  msn: z.string().trim().min(1, 'MSN requis').max(50, 'MSN trop long'),
  registration: optionalText(),
  manufacturer: z.string().trim().min(1, 'Constructeur requis'),
  model: z.string().trim().min(1, 'Modèle requis'),
  variant: optionalText(),
  yearBuilt: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ required_error: 'Année requise', invalid_type_error: 'Année invalide' })
      .int('Année invalide')
      .min(1950, 'Année ne peut pas être antérieure à 1950')
      .max(CURRENT_YEAR + 3, `Année ne peut pas dépasser ${CURRENT_YEAR + 3}`)
  ),
  status: z.nativeEnum(AssetStatus, {
    errorMap: () => ({ message: 'Statut invalide' }),
  }),
  totalHours: optionalInt('Heures de vol invalides'),
  totalCycles: optionalInt('Cycles invalides'),
  cabinConfig: optionalText(),
  seatCount: optionalInt('Nombre de sièges invalide'),
  mtowKg: optionalInt('MTOW invalide'),
  cofaExpiryDate: optionalDate(),
  insuranceExpiryDate: optionalDate(),
});

export type AircraftFormValues = z.infer<typeof aircraftSchema>;

// Défini ici plutôt que dans lib/actions/aircraft.ts : un fichier 'use
// server' ne peut exporter que des fonctions async — pas de const ni de
// type (les types sont de toute façon effacés à la compilation, mais la
// const emptyAircraftFormState est une vraie valeur runtime).
export interface AircraftFormState {
  errors: Record<string, string>;
  formError?: string;
  // Valeurs brutes soumises, réinjectées comme defaultValue : React 19
  // réinitialise les champs non contrôlés d'un <form action> après
  // exécution — sans ça, une erreur de validation effacerait tout ce que
  // l'utilisateur a saisi, pas seulement le champ en faute.
  values?: Record<string, string>;
}

export const emptyAircraftFormState: AircraftFormState = { errors: {} };
