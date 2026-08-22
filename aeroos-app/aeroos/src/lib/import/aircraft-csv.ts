import { AssetStatus } from '@prisma/client';

/**
 * Import CSV d'actifs — parsing tolérant aux données sales (risque n°1
 * identifié : les lessors ont des données en désordre). Ce module est pur
 * (aucun accès base) : réutilisé tel quel côté client pour la
 * prévisualisation et côté serveur pour l'import réel, afin de garantir
 * que l'aperçu correspond exactement à ce qui sera importé.
 */

export const AIRCRAFT_CSV_FIELDS = [
  { key: 'msn', label: 'MSN', required: true },
  { key: 'manufacturer', label: 'Constructeur', required: true },
  { key: 'model', label: 'Modèle', required: true },
  { key: 'yearBuilt', label: 'Année de construction', required: true },
  { key: 'registration', label: 'Immatriculation', required: false },
  { key: 'variant', label: 'Variante', required: false },
  { key: 'status', label: 'Statut', required: false },
  { key: 'totalHours', label: 'Heures de vol (FH)', required: false },
  { key: 'totalCycles', label: 'Cycles (FC)', required: false },
  { key: 'cabinConfig', label: 'Configuration cabine', required: false },
  { key: 'seatCount', label: 'Nombre de sièges', required: false },
  { key: 'mtowKg', label: 'MTOW (kg)', required: false },
] as const;

export type AircraftCsvField = (typeof AIRCRAFT_CSV_FIELDS)[number]['key'];

export type ColumnMapping = Partial<Record<AircraftCsvField, string>>;

export interface AircraftImportRow {
  msn: string;
  manufacturer: string;
  model: string;
  yearBuilt: number;
  registration: string | null;
  variant: string | null;
  status: AssetStatus;
  totalHours: number;
  totalCycles: number;
  cabinConfig: string | null;
  seatCount: number | null;
  mtowKg: number | null;
}

export type RowParseResult =
  | { ok: true; data: AircraftImportRow; errors: never[] }
  | { ok: false; data?: undefined; errors: string[] };

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Tolère espaces (y compris insécables), virgule ou point décimal, et
 * virgule ou point comme séparateur de milliers — heuristique, pas une
 * détection de locale exacte.
 */
export function parseFlexibleNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === '') return null;
  s = s.replace(/[\s ]/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accepte YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY. Pour le format à barres
 * obliques, désambiguïse par la valeur (jour/mois > 12) ; par défaut
 * DD/MM/YYYY (convention européenne, cohérente avec le reste de l'app).
 */
export function parseFlexibleDate(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '') return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    const year = Number(m[3]);
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function cell(row: Record<string, string>, mapping: ColumnMapping, field: AircraftCsvField): string | undefined {
  const col = mapping[field];
  if (!col) return undefined;
  const v = row[col];
  return v == null ? undefined : v.trim();
}

/**
 * Convertit une ligne CSV brute (indexée par en-tête de colonne) en un
 * actif prêt à insérer, selon la correspondance colonne → champ choisie
 * par l'utilisateur. Ne touche jamais la base — un champ requis absent ou
 * invalide produit une erreur sur CETTE ligne, sans jamais lever
 * d'exception (l'appelant décide s'il continue ou non).
 */
export function mapCsvRow(row: Record<string, string>, mapping: ColumnMapping): RowParseResult {
  const errors: string[] = [];

  const msn = cell(row, mapping, 'msn');
  if (!msn) errors.push('MSN manquant');

  const manufacturer = cell(row, mapping, 'manufacturer');
  if (!manufacturer) errors.push('Constructeur manquant');

  const model = cell(row, mapping, 'model');
  if (!model) errors.push('Modèle manquant');

  const yearRaw = cell(row, mapping, 'yearBuilt');
  const yearBuilt = yearRaw != null ? parseFlexibleNumber(yearRaw) : null;
  if (yearRaw == null || yearRaw === '') {
    errors.push('Année de construction manquante');
  } else if (yearBuilt == null || !Number.isInteger(yearBuilt)) {
    errors.push(`Année de construction invalide ("${yearRaw}")`);
  } else if (yearBuilt < 1950 || yearBuilt > CURRENT_YEAR + 3) {
    errors.push(`Année de construction hors plage (${yearBuilt})`);
  }

  const statusRaw = cell(row, mapping, 'status');
  let status: AssetStatus = 'OFF_LEASE';
  if (statusRaw) {
    const normalized = statusRaw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if ((Object.values(AssetStatus) as string[]).includes(normalized)) {
      status = normalized as AssetStatus;
    } else {
      errors.push(`Statut inconnu ("${statusRaw}")`);
    }
  }

  const totalHoursRaw = cell(row, mapping, 'totalHours');
  const totalHours = totalHoursRaw ? parseFlexibleNumber(totalHoursRaw) : 0;
  if (totalHoursRaw && totalHours == null) errors.push(`Heures de vol invalides ("${totalHoursRaw}")`);

  const totalCyclesRaw = cell(row, mapping, 'totalCycles');
  const totalCycles = totalCyclesRaw ? parseFlexibleNumber(totalCyclesRaw) : 0;
  if (totalCyclesRaw && totalCycles == null) errors.push(`Cycles invalides ("${totalCyclesRaw}")`);

  const seatCountRaw = cell(row, mapping, 'seatCount');
  const seatCount = seatCountRaw ? parseFlexibleNumber(seatCountRaw) : null;
  if (seatCountRaw && seatCount == null) errors.push(`Nombre de sièges invalide ("${seatCountRaw}")`);

  const mtowRaw = cell(row, mapping, 'mtowKg');
  const mtowKg = mtowRaw ? parseFlexibleNumber(mtowRaw) : null;
  if (mtowRaw && mtowKg == null) errors.push(`MTOW invalide ("${mtowRaw}")`);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    data: {
      msn: msn!,
      manufacturer: manufacturer!,
      model: model!,
      yearBuilt: yearBuilt!,
      registration: cell(row, mapping, 'registration') || null,
      variant: cell(row, mapping, 'variant') || null,
      status,
      totalHours: totalHours ?? 0,
      totalCycles: totalCycles ?? 0,
      cabinConfig: cell(row, mapping, 'cabinConfig') || null,
      seatCount: seatCount ?? null,
      mtowKg: mtowKg ?? null,
    },
  };
}

/**
 * Devine une correspondance colonne → champ à partir des en-têtes du CSV
 * (comparaison insensible à la casse/ponctuation). Point de départ pour
 * l'utilisateur, jamais appliqué sans confirmation.
 */
export function guessColumnMapping(headers: string[]): ColumnMapping {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<AircraftCsvField, string[]> = {
    msn: ['msn', 'serialnumber', 'manufacturerserialnumber'],
    manufacturer: ['manufacturer', 'constructeur', 'oem'],
    model: ['model', 'modele', 'type', 'aircrafttype'],
    yearBuilt: ['yearbuilt', 'anneedeconstruction', 'year', 'annee'],
    registration: ['registration', 'immatriculation', 'reg', 'tailnumber'],
    variant: ['variant', 'variante'],
    status: ['status', 'statut'],
    totalHours: ['totalhours', 'heuresdevol', 'fh', 'flighthours'],
    totalCycles: ['totalcycles', 'cycles', 'fc', 'flightcycles'],
    cabinConfig: ['cabinconfig', 'configurationcabine', 'cabin'],
    seatCount: ['seatcount', 'nombredesieges', 'seats'],
    mtowKg: ['mtowkg', 'mtow'],
  };

  const mapping: ColumnMapping = {};
  for (const field of AIRCRAFT_CSV_FIELDS) {
    const match = headers.find((h) => aliases[field.key].includes(normalize(h)));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

export interface ImportReportRow {
  line: number;
  reasons: string[];
}

export interface ImportReport {
  created: number;
  skipped: number;
  errors: ImportReportRow[];
}

// Défini ici plutôt que dans lib/actions/aircraft-import.ts : un fichier
// 'use server' ne peut exporter que des fonctions async.
export interface ImportFormState {
  report?: ImportReport;
  formError?: string;
}

export const emptyImportFormState: ImportFormState = {};

export function buildTemplateCsv(): string {
  const headers = AIRCRAFT_CSV_FIELDS.map((f) => f.key);
  const example = [
    'MSN12345', 'Airbus', 'A320', '2015', 'F-EXAMPLE', '-200',
    'OFF_LEASE', '18500', '9200', '174Y', '180', '73500',
  ];
  return `${headers.join(',')}\n${example.join(',')}\n`;
}
