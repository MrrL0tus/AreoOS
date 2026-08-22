import { describe, it, expect } from 'vitest';
import { normalizeName, similarity, screenName } from './sanctions';

describe('normalizeName', () => {
  it('met en minuscules, retire ponctuation et accents', () => {
    expect(normalizeName('Meridian Aviation Capital')).toBe('meridian aviation capital');
    // NFD + suppression des marques combinantes : accent retiré, lettre
    // de base conservée ("é" → "e"), contrairement au parsing CSV (T2.4)
    // qui, lui, supprime la lettre accentuée entière.
    expect(normalizeName('Aéro-Frêt S.A.')).toBe('aero fret s a');
  });

  it('réduit les espaces multiples', () => {
    expect(normalizeName('Iberavia   Corp')).toBe('iberavia corp');
  });
});

describe('similarity', () => {
  it('1.0 pour deux noms identiques (normalisés)', () => {
    expect(similarity('Iberavia', 'IBERAVIA')).toBe(1);
    // La ponctuation devient un espace de chaque côté, donc "A.B.C. Corp"
    // et "A B C Corp" se normalisent bien vers la même chaîne — au
    // contraire de "S.A." vs "SA" (testé séparément) qui ne fusionnent
    // PAS ("s a" ≠ "sa"), une limite réelle de cette heuristique.
    expect(similarity('A.B.C. Corp', 'A B C Corp')).toBe(1);
  });

  it("une abréviation avec points (\"S.A.\") ne fusionne pas avec sa forme sans points (\"SA\") — limite connue de l'heuristique", () => {
    // "S.A. Test" → "s a test" (3 tokens) vs "SA Test" → "sa test" (2
    // tokens) : proche mais pas identique. Documenté comme limite plutôt
    // que "corrigé" ici — screenName() compense par le seuil FLAGGED à
    // 85 % plutôt que d'exiger une correspondance exacte.
    const sim = similarity('S.A. Test', 'SA Test');
    expect(sim).toBeGreaterThanOrEqual(0.85);
    expect(sim).toBeLessThan(1);
  });

  it('proche de 1 pour une variante mineure (translittération / abréviation)', () => {
    const sim = similarity('Zephyr Cargo Holdings', 'Zephyr Cargo Holding');
    expect(sim).toBeGreaterThan(0.9);
  });

  it('faible pour deux noms sans rapport', () => {
    const sim = similarity('Meridian Aviation Capital', 'Northline Trading Corp');
    expect(sim).toBeLessThan(0.5);
  });
});

describe('screenName (comparaison à une liste de référence injectée)', () => {
  const fakeCandidates = [
    { id: '1', name: 'Northline Trading Corp', program: 'SDN', source: 'TEST' },
    { id: '2', name: 'Zephyr Cargo Holdings', program: 'SDN', source: 'TEST' },
  ];
  const fakeTx = {
    sanctionedEntity: { findMany: async () => fakeCandidates },
  };

  it('CLEAR quand aucune correspondance ne dépasse le seuil', async () => {
    const result = await screenName('Meridian Aviation Capital', fakeTx);
    expect(result.status).toBe('CLEAR');
    expect(result.bestMatch).toBeNull();
  });

  it('BLOCKED sur correspondance exacte (normalisée)', async () => {
    const result = await screenName('Northline Trading Corp', fakeTx);
    expect(result.status).toBe('BLOCKED');
    expect(result.bestMatch?.entityId).toBe('1');
  });

  it('FLAGGED sur correspondance approchante (>= 85%, < exacte)', async () => {
    // "Zephyr Cargo Holding" (singulier) vs "Zephyr Cargo Holdings" en
    // liste : une seule lettre d'écart → similarité ~0.95, sous le seuil
    // d'exactitude (0.999) mais au-dessus du seuil de signalement (0.85).
    const result = await screenName('Zephyr Cargo Holding', fakeTx);
    expect(result.status).toBe('FLAGGED');
    expect(result.bestMatch?.entityId).toBe('2');
  });

  it('trie les correspondances multiples par similarité décroissante', async () => {
    const result = await screenName('Northline Trading Corp', fakeTx);
    if (result.matches.length > 1) {
      for (let i = 1; i < result.matches.length; i++) {
        expect(result.matches[i - 1].similarity).toBeGreaterThanOrEqual(result.matches[i].similarity);
      }
    }
  });
});
