import { describe, it, expect } from 'vitest';
import {
  parseFlexibleNumber, parseFlexibleDate, mapCsvRow, guessColumnMapping,
  buildTemplateCsv, AIRCRAFT_CSV_FIELDS, type ColumnMapping,
} from './aircraft-csv';

describe('parseFlexibleNumber — tolère des données sales', () => {
  it('nombre simple', () => {
    expect(parseFlexibleNumber('18500')).toBe(18500);
  });
  it('virgule décimale (convention européenne)', () => {
    expect(parseFlexibleNumber('18500,5')).toBe(18500.5);
  });
  it('point décimal (convention US)', () => {
    expect(parseFlexibleNumber('18500.5')).toBe(18500.5);
  });
  it('séparateur de milliers par point, virgule décimale', () => {
    expect(parseFlexibleNumber('18.500,5')).toBe(18500.5);
  });
  it('séparateur de milliers par virgule, point décimal', () => {
    expect(parseFlexibleNumber('18,500.5')).toBe(18500.5);
  });
  it('espaces (y compris insécables) comme séparateur de milliers', () => {
    expect(parseFlexibleNumber('18 500')).toBe(18500);
    expect(parseFlexibleNumber('18 500')).toBe(18500);
  });
  it('valeur vide ou absente → null, jamais d\'exception', () => {
    expect(parseFlexibleNumber('')).toBeNull();
    expect(parseFlexibleNumber('   ')).toBeNull();
    expect(parseFlexibleNumber(null)).toBeNull();
    expect(parseFlexibleNumber(undefined)).toBeNull();
  });
  it('texte non numérique → null', () => {
    expect(parseFlexibleNumber('abc')).toBeNull();
    expect(parseFlexibleNumber('N/A')).toBeNull();
  });
});

describe('parseFlexibleDate — tolère plusieurs formats', () => {
  it('YYYY-MM-DD', () => {
    const d = parseFlexibleDate('2020-03-15');
    expect(d?.getFullYear()).toBe(2020);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(15);
  });
  it('DD/MM/YYYY (convention européenne par défaut)', () => {
    const d = parseFlexibleDate('15/03/2020');
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(15);
  });
  it('MM/DD/YYYY désambiguïsé quand le second segment dépasse 12', () => {
    // "02/13/2020" ne peut pas être DD/MM (mois 13 invalide) → interprété
    // comme MM/DD américain : février (mois 1, zero-indexed), jour 13.
    const d = parseFlexibleDate('02/13/2020');
    expect(d?.getMonth()).toBe(1);
    expect(d?.getDate()).toBe(13);
  });
  it('date invalide (mois > 12 des deux côtés) → null', () => {
    expect(parseFlexibleDate('13/13/2020')).toBeNull();
  });
  it('valeur vide ou absente → null', () => {
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate(null)).toBeNull();
    expect(parseFlexibleDate(undefined)).toBeNull();
  });
  it('texte non-date → null', () => {
    expect(parseFlexibleDate('pas une date')).toBeNull();
  });
});

const FULL_MAPPING: ColumnMapping = Object.fromEntries(
  AIRCRAFT_CSV_FIELDS.map((f) => [f.key, f.key])
) as ColumnMapping;

describe('mapCsvRow', () => {
  it('ligne complète et valide', () => {
    const row = {
      msn: 'MSN001', manufacturer: 'Airbus', model: 'A320', yearBuilt: '2018',
      registration: 'F-TEST', variant: '-200', status: 'OFF_LEASE',
      totalHours: '15 000', totalCycles: '9 200',
      cabinConfig: '174Y', seatCount: '180', mtowKg: '73 500',
    };
    const result = mapCsvRow(row, FULL_MAPPING);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.msn).toBe('MSN001');
      expect(result.data.yearBuilt).toBe(2018);
      expect(result.data.totalHours).toBe(15000);
      expect(result.data.status).toBe('OFF_LEASE');
    }
  });

  it('champs requis manquants → erreurs, jamais d\'exception, pas de "ok: true"', () => {
    const result = mapCsvRow({}, FULL_MAPPING);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('MSN'))).toBe(true);
    }
  });

  it('colonne non mappée pour un champ requis → erreur (pas de valeur par défaut inventée)', () => {
    const partialMapping: ColumnMapping = { msn: 'msn' };
    const result = mapCsvRow({ msn: 'MSN001' }, partialMapping);
    expect(result.ok).toBe(false);
  });

  it('année hors plage → erreur explicite', () => {
    const row = { msn: 'X', manufacturer: 'A', model: 'B', yearBuilt: '1900' };
    const result = mapCsvRow(row, FULL_MAPPING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('hors plage'))).toBe(true);
  });

  it('statut inconnu → erreur (pas d\'écriture silencieuse d\'un statut par défaut)', () => {
    const row = { msn: 'X', manufacturer: 'A', model: 'B', yearBuilt: '2018', status: 'NIMPORTEQUOI' };
    const result = mapCsvRow(row, FULL_MAPPING);
    expect(result.ok).toBe(false);
  });

  it('statut absent → défaut OFF_LEASE, pas d\'erreur', () => {
    const row = { msn: 'X', manufacturer: 'A', model: 'B', yearBuilt: '2018' };
    const result = mapCsvRow(row, FULL_MAPPING);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe('OFF_LEASE');
  });

  it('heures de vol non numériques → erreur ciblée sur ce champ', () => {
    const row = { msn: 'X', manufacturer: 'A', model: 'B', yearBuilt: '2018', totalHours: 'beaucoup' };
    const result = mapCsvRow(row, FULL_MAPPING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('Heures de vol'))).toBe(true);
  });
});

describe('guessColumnMapping', () => {
  it('reconnaît des en-têtes variés par alias normalisé', () => {
    // Note : normalize() ne fait que retirer la ponctuation/espaces, pas
    // un repli d'accents (pas de décomposition NFD) — un en-tête accentué
    // qui ne figure pas explicitement dans les alias ne matche pas (cf.
    // "Modèle" plus bas, volontairement testé comme cas non reconnu).
    const headers = ['MSN', 'Constructeur', 'Model', 'Year', 'Immatriculation'];
    const mapping = guessColumnMapping(headers);
    expect(mapping.msn).toBe('MSN');
    expect(mapping.manufacturer).toBe('Constructeur');
    expect(mapping.model).toBe('Model');
    expect(mapping.yearBuilt).toBe('Year');
    expect(mapping.registration).toBe('Immatriculation');
  });

  it("un en-tête accentué non listé dans les alias n'est pas reconnu (limite connue)", () => {
    const mapping = guessColumnMapping(['Modèle']);
    expect(mapping.model).toBeUndefined();
  });

  it('ignore les en-têtes sans correspondance', () => {
    const mapping = guessColumnMapping(['Colonne mystère']);
    expect(mapping.msn).toBeUndefined();
  });
});

describe('buildTemplateCsv', () => {
  it('produit un en-tête suivi d\'une ligne d\'exemple ré-important sans erreur', () => {
    const csv = buildTemplateCsv();
    const [headerLine, exampleLine] = csv.trim().split('\n');
    const headers = headerLine.split(',');
    const values = exampleLine.split(',');
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    const mapping: ColumnMapping = Object.fromEntries(headers.map((h) => [h, h])) as ColumnMapping;

    const result = mapCsvRow(row, mapping);
    expect(result.ok).toBe(true);
  });
});
