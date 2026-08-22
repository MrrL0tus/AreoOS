import { describe, it, expect } from 'vitest';
import { calculateValuation, buildValueCurve, AIRCRAFT_PROFILES, DEFAULT_MARKET } from './valuation';

const REF_DATE = new Date('2026-01-01T00:00:00Z');

function baseInput(overrides: Partial<Parameters<typeof calculateValuation>[0]> = {}) {
  return {
    manufacturer: 'Airbus',
    model: 'A320',
    variant: 'neo',
    yearBuilt: 2020,
    totalHours: 15000,
    totalCycles: 9500,
    valuationDate: REF_DATE,
    ...overrides,
  };
}

describe('calculateValuation', () => {
  it('applique le profil connu du référentiel pour un type listé', () => {
    const result = calculateValuation(baseInput());
    expect(result.breakdown.typeProfile).toBe('A320neo');
    expect(AIRCRAFT_PROFILES['A320neo']).toBeDefined();
    expect(result.confidenceNotes.some((n) => n.includes('absent du référentiel'))).toBe(false);
  });

  it("bascule sur le profil générique pour un type inconnu du référentiel", () => {
    const result = calculateValuation(
      baseInput({ manufacturer: 'ACME', model: 'Zorglub', variant: '9000' })
    );
    expect(result.breakdown.typeProfile).toBe('Zorglub-9000');
    expect(result.confidenceNotes.some((n) => n.includes('absent du référentiel'))).toBe(true);
    // Le profil générique reste utilisable — pas de valeur aberrante
    expect(result.baseValue).toBeGreaterThan(0);
    expect(result.confidence).not.toBe('HIGH'); // pénalité de confiance appliquée
  });

  it('un avion tout juste livré (age ~0) vaut proche du prix catalogue', () => {
    const result = calculateValuation(
      baseInput({ yearBuilt: 2026, totalHours: 0, totalCycles: 0, valuationDate: REF_DATE })
    );
    expect(result.breakdown.ageYears).toBeLessThanOrEqual(0.1);
    expect(result.baseValue).toBeGreaterThan(
      AIRCRAFT_PROFILES['A320neo'].listPriceMusd * 1_000_000 * 0.85
    );
  });

  it('un avion très ancien (au-delà de la vie économique) plafonne à la valeur plancher', () => {
    const result = calculateValuation(
      baseInput({ yearBuilt: 1960, totalHours: 200000, totalCycles: 140000 })
    );
    const profile = AIRCRAFT_PROFILES['A320neo'];
    const floor = profile.listPriceMusd * 1_000_000 * (profile.floorPct / 100);

    // Base Value ne descend jamais sous le plancher
    expect(result.baseValue).toBeGreaterThanOrEqual(floor - 0.01);
    // Residual Value à 5 ans : bien au-delà de la vie économique → plancher exact
    expect(result.residualValue).toBeCloseTo(floor, 2);
    expect(result.confidenceNotes).toContain(
      'Projection au-delà de la vie économique du type'
    );
  });

  it('heures et cycles nuls : aucun ajustement d\'utilisation, note explicite', () => {
    const result = calculateValuation(baseInput({ totalHours: 0, totalCycles: 0 }));
    expect(result.breakdown.utilizationAdjustmentPct).toBe(0);
    expect(
      result.confidenceNotes.some((n) => n.includes("Données d'utilisation absentes"))
    ).toBe(true);
  });

  it('confiance HIGH pour un cas complet et bien documenté', () => {
    const result = calculateValuation(
      baseInput({
        engines: [
          { llpCyclesRemaining: 15000, egtMargin: 45 },
          { llpCyclesRemaining: 14000, egtMargin: 42 },
        ],
        hoursQuality: 'CERTIFIED',
      })
    );
    expect(result.confidence).toBe('HIGH');
  });

  it('confiance LOW quand type inconnu + pas de moteurs + pas de cycles + données estimées', () => {
    const result = calculateValuation(
      baseInput({
        manufacturer: 'ACME',
        model: 'Unknown',
        totalCycles: 0,
        hoursQuality: 'ESTIMATED',
      })
    );
    expect(result.confidence).toBe('LOW');
  });

  it('un LLP critique (< 2000 cycles) dégrade la valeur et le note', () => {
    const withoutLlpIssue = calculateValuation(
      baseInput({ engines: [{ llpCyclesRemaining: 15000, egtMargin: 45 }] })
    );
    const withLlpIssue = calculateValuation(
      baseInput({ engines: [{ llpCyclesRemaining: 1500, egtMargin: 45 }] })
    );
    expect(withLlpIssue.baseValue).toBeLessThan(withoutLlpIssue.baseValue);
    expect(
      withLlpIssue.confidenceNotes.some((n) => n.includes('LLP critique'))
    ).toBe(true);
  });

  it('des AD ouvertes en nombre dégradent la valeur', () => {
    const clean = calculateValuation(baseInput({ openAdCount: 0 }));
    const withAds = calculateValuation(baseInput({ openAdCount: 5 }));
    expect(withAds.baseValue).toBeLessThan(clean.baseValue);
    expect(withAds.confidenceNotes.some((n) => n.includes('AD ouvertes'))).toBe(true);
  });

  it('une visite lourde en retard pénalise plus qu\'une visite imminente', () => {
    const upcoming = calculateValuation(
      baseInput({ nextHeavyCheckDate: new Date('2026-03-01') }) // dans 2 mois
    );
    const overdue = calculateValuation(
      baseInput({ nextHeavyCheckDate: new Date('2025-06-01') }) // passée
    );
    expect(overdue.baseValue).toBeLessThan(upcoming.baseValue);
  });

  it('inclut systématiquement la mention de non-certification (conformité §4.3)', () => {
    const result = calculateValuation(baseInput());
    expect(result.disclaimer).toMatch(/appraisal certifié/i);
  });

  it('un marché déprimé réduit la Current Market Value sous la Base Value', () => {
    const depressedMarket = {
      ...DEFAULT_MARKET,
      marketMultiplier: 0.7,
      generationAdjustment: { current: 1, previous: 1, legacy: 1 },
    };
    const result = calculateValuation(baseInput({ market: depressedMarket }));
    expect(result.currentMarketValue).toBeLessThan(result.baseValue);
  });
});

describe('buildValueCurve', () => {
  it('génère un point par pas d\'âge jusqu\'à la vie économique du type', () => {
    const input = baseInput();
    const curve = buildValueCurve(input, { stepYears: 5 });
    const profile = AIRCRAFT_PROFILES['A320neo'];
    expect(curve[0].age).toBe(0);
    expect(curve[curve.length - 1].age).toBeLessThanOrEqual(profile.economicLifeYears);
    expect(curve[curve.length - 1].age).toBeGreaterThan(profile.economicLifeYears - 5);
  });

  it('la valeur décroît globalement avec l\'âge (tendance, pas strictement monotone)', () => {
    const curve = buildValueCurve(baseInput(), { stepYears: 1 });
    expect(curve[curve.length - 1].baseValue).toBeLessThan(curve[0].baseValue);
  });
});
