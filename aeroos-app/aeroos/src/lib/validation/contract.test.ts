import { describe, it, expect } from 'vitest';
import { contractSchema } from './contract';

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'CTR-2026-001',
    aircraftId: 'aircraft-1',
    lesseeId: 'operator-1',
    lessorName: 'Meridian Aviation Capital',
    startDate: '2026-01-01',
    endDate: '2030-01-01',
    currency: 'USD',
    monthlyRent: '250000',
    status: 'DRAFT',
    hasPurchaseOption: false,
    hasExtensionOption: false,
    hasEarlyTermination: false,
    ...overrides,
  };
}

describe('contractSchema', () => {
  it('accepte un contrat minimal valide', () => {
    const result = contractSchema.safeParse(validRow());
    expect(result.success).toBe(true);
  });

  it('rejette endDate <= startDate (règle métier T2.2)', () => {
    const result = contractSchema.safeParse(
      validRow({ startDate: '2030-01-01', endDate: '2026-01-01' })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('endDate'))).toBe(true);
    }
  });

  it('rejette un loyer mensuel négatif ou nul', () => {
    expect(contractSchema.safeParse(validRow({ monthlyRent: '-100' })).success).toBe(false);
    expect(contractSchema.safeParse(validRow({ monthlyRent: '0' })).success).toBe(false);
  });

  it('rejette une référence vide', () => {
    expect(contractSchema.safeParse(validRow({ reference: '' })).success).toBe(false);
  });

  it('convertit les cases à cocher HTML ("on") en booléen', () => {
    const result = contractSchema.safeParse(validRow({ hasPurchaseOption: 'on' }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.hasPurchaseOption).toBe(true);
  });

  it('rejette un statut hors énumération', () => {
    expect(contractSchema.safeParse(validRow({ status: 'INEXISTANT' })).success).toBe(false);
  });

  it('accepte des montants de MR optionnels absents', () => {
    const result = contractSchema.safeParse(validRow());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mrEngineLeft).toBeUndefined();
  });
});
