import { describe, it, expect } from 'vitest';
import { aircraftSchema } from './aircraft';

const CURRENT_YEAR = new Date().getFullYear();

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    msn: 'MSN12345',
    manufacturer: 'Airbus',
    model: 'A320',
    yearBuilt: '2018',
    status: 'OFF_LEASE',
    ...overrides,
  };
}

describe('aircraftSchema', () => {
  it('accepte une ligne minimale valide', () => {
    const result = aircraftSchema.safeParse(validRow());
    expect(result.success).toBe(true);
  });

  it('rejette un MSN vide', () => {
    const result = aircraftSchema.safeParse(validRow({ msn: '' }));
    expect(result.success).toBe(false);
  });

  it('rejette une année avant 1950', () => {
    const result = aircraftSchema.safeParse(validRow({ yearBuilt: '1940' }));
    expect(result.success).toBe(false);
  });

  it(`rejette une année après ${CURRENT_YEAR + 3}`, () => {
    const result = aircraftSchema.safeParse(validRow({ yearBuilt: String(CURRENT_YEAR + 5) }));
    expect(result.success).toBe(false);
  });

  it('rejette un statut hors énumération', () => {
    const result = aircraftSchema.safeParse(validRow({ status: 'NIMPORTEQUOI' }));
    expect(result.success).toBe(false);
  });

  it('des champs texte optionnels vides sont traités comme absents (pas d\'erreur)', () => {
    const result = aircraftSchema.safeParse(validRow({ registration: '', variant: '' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registration).toBeUndefined();
    }
  });

  it('coerce les champs numériques optionnels fournis en string', () => {
    const result = aircraftSchema.safeParse(validRow({ totalHours: '15000' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalHours).toBe(15000);
  });

  it('rejette un champ numérique optionnel non numérique', () => {
    const result = aircraftSchema.safeParse(validRow({ totalHours: 'beaucoup' }));
    expect(result.success).toBe(false);
  });
});
