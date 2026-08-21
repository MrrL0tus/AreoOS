/**
 * AeroOS — Valuation Engine
 * ═══════════════════════════════════════════════════════════════════
 *
 * Calcule trois valeurs pour un actif aéronautique :
 *
 *   Base Value (BV)          — valeur théorique en conditions de marché
 *                              équilibrées, actif en half-life condition
 *   Current Market Value     — BV ajustée des conditions réelles du marché
 *   Residual / Future Value  — projection à une date future
 *
 * ⚠️  AVERTISSEMENT RÉGLEMENTAIRE (cf. Cahier de conformité §4.3)
 * Ces valeurs sont des ESTIMATIONS ALGORITHMIQUES. Elles ne constituent
 * pas des appraisals certifiés au sens des standards ISTAT / ASA / RICS
 * et ne peuvent pas être utilisées pour du financement bancaire, du
 * reporting réglementaire ou en cas de litige.
 *
 * Méthodologie : approche par dépréciation depuis le prix catalogue,
 * ajustée par l'état technique, l'utilisation et le contexte marché.
 * C'est une approximation de la méthode utilisée par les appraisers.
 */

import type { DataQuality } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────
// Référentiel des types d'appareils
// ─────────────────────────────────────────────────────────────────
// Prix catalogue approximatifs et courbes de dépréciation.
// EN PRODUCTION : ces données viennent d'un abonnement (Cirium, IBA)
// ou d'une base de transactions comparables. Les valeurs ci-dessous
// sont des ordres de grandeur publics servant de point de départ.

export interface AircraftTypeProfile {
  /** Prix catalogue neuf approximatif, USD millions */
  listPriceMusd: number;
  /** Décote la première année (livraison → 1 an), en % */
  firstYearDepreciation: number;
  /** Taux de dépréciation annuel en régime, en % */
  annualDepreciation: number;
  /** Valeur plancher en % du prix catalogue (valeur de démantèlement) */
  floorPct: number;
  /** Durée de vie économique en années */
  economicLifeYears: number;
  /** Cycles moyens par an pour un usage standard */
  typicalCyclesPerYear: number;
  /** Heures moyennes par an */
  typicalHoursPerYear: number;
  /** Génération : impacte la demande résiduelle */
  generation: 'current' | 'previous' | 'legacy';
}

export const AIRCRAFT_PROFILES: Record<string, AircraftTypeProfile> = {
  // ── Narrowbody génération actuelle ──
  'A320neo': {
    listPriceMusd: 110, firstYearDepreciation: 12, annualDepreciation: 4.0,
    floorPct: 12, economicLifeYears: 25, typicalCyclesPerYear: 1800,
    typicalHoursPerYear: 2800, generation: 'current',
  },
  'A321neo': {
    listPriceMusd: 129, firstYearDepreciation: 11, annualDepreciation: 3.8,
    floorPct: 12, economicLifeYears: 25, typicalCyclesPerYear: 1700,
    typicalHoursPerYear: 3000, generation: 'current',
  },
  'B737 MAX 8': {
    listPriceMusd: 121, firstYearDepreciation: 13, annualDepreciation: 4.2,
    floorPct: 12, economicLifeYears: 25, typicalCyclesPerYear: 1800,
    typicalHoursPerYear: 2900, generation: 'current',
  },

  // ── Narrowbody génération précédente ──
  'A320-200': {
    listPriceMusd: 98, firstYearDepreciation: 14, annualDepreciation: 5.2,
    floorPct: 8, economicLifeYears: 25, typicalCyclesPerYear: 1900,
    typicalHoursPerYear: 2700, generation: 'previous',
  },
  'A321-200': {
    listPriceMusd: 114, firstYearDepreciation: 13, annualDepreciation: 5.0,
    floorPct: 8, economicLifeYears: 25, typicalCyclesPerYear: 1750,
    typicalHoursPerYear: 2850, generation: 'previous',
  },
  'A319-100': {
    listPriceMusd: 89, firstYearDepreciation: 15, annualDepreciation: 5.8,
    floorPct: 7, economicLifeYears: 24, typicalCyclesPerYear: 2000,
    typicalHoursPerYear: 2600, generation: 'previous',
  },
  'B737-800': {
    listPriceMusd: 96, firstYearDepreciation: 14, annualDepreciation: 5.4,
    floorPct: 8, economicLifeYears: 25, typicalCyclesPerYear: 1900,
    typicalHoursPerYear: 2750, generation: 'previous',
  },
  'B737-700': {
    listPriceMusd: 82, firstYearDepreciation: 15, annualDepreciation: 6.0,
    floorPct: 7, economicLifeYears: 24, typicalCyclesPerYear: 2000,
    typicalHoursPerYear: 2600, generation: 'previous',
  },

  // ── Widebody ──
  'A330-300': {
    listPriceMusd: 264, firstYearDepreciation: 15, annualDepreciation: 6.2,
    floorPct: 6, economicLifeYears: 24, typicalCyclesPerYear: 700,
    typicalHoursPerYear: 4200, generation: 'previous',
  },
  'A350-900': {
    listPriceMusd: 317, firstYearDepreciation: 11, annualDepreciation: 4.2,
    floorPct: 10, economicLifeYears: 26, typicalCyclesPerYear: 650,
    typicalHoursPerYear: 4600, generation: 'current',
  },
  'B787-9': {
    listPriceMusd: 292, firstYearDepreciation: 11, annualDepreciation: 4.4,
    floorPct: 10, economicLifeYears: 26, typicalCyclesPerYear: 650,
    typicalHoursPerYear: 4500, generation: 'current',
  },
  'B777-300ER': {
    listPriceMusd: 375, firstYearDepreciation: 14, annualDepreciation: 6.5,
    floorPct: 5, economicLifeYears: 24, typicalCyclesPerYear: 600,
    typicalHoursPerYear: 4400, generation: 'previous',
  },
};

/** Profil par défaut si le type n'est pas au référentiel */
const DEFAULT_PROFILE: AircraftTypeProfile = {
  listPriceMusd: 90, firstYearDepreciation: 14, annualDepreciation: 5.5,
  floorPct: 8, economicLifeYears: 24, typicalCyclesPerYear: 1800,
  typicalHoursPerYear: 2700, generation: 'previous',
};

// ─────────────────────────────────────────────────────────────────
// Conditions de marché
// ─────────────────────────────────────────────────────────────────

export interface MarketConditions {
  /**
   * Multiplicateur global du marché.
   * 1.00 = marché équilibré (BV = CMV)
   * < 1  = marché déprimé (surcapacité, crise)
   * > 1  = marché tendu (pénurie d'appareils)
   */
  marketMultiplier: number;
  /** Ajustement par génération (demande différenciée) */
  generationAdjustment: {
    current: number;
    previous: number;
    legacy: number;
  };
  /** Date de référence des conditions */
  asOfDate: Date;
  /** Source des paramètres */
  source: string;
}

/**
 * Conditions de marché par défaut — à remplacer par un flux de données
 * réel (Cirium market indices, transactions comparables) en production.
 */
export const DEFAULT_MARKET: MarketConditions = {
  marketMultiplier: 0.965,
  generationAdjustment: {
    current: 1.02,   // appareils neo/MAX : demande forte
    previous: 0.96,  // génération ceo/NG : demande correcte mais en baisse
    legacy: 0.85,    // appareils anciens : demande faible
  },
  asOfDate: new Date(),
  source: 'AeroOS default parameters (à remplacer par flux marché)',
};

// ─────────────────────────────────────────────────────────────────
// Entrées du calcul
// ─────────────────────────────────────────────────────────────────

export interface ValuationInput {
  manufacturer: string;
  model: string;
  variant?: string | null;
  yearBuilt: number;
  totalHours: number;
  totalCycles: number;
  hoursQuality?: DataQuality;

  /** Statut moteurs : impacte fortement la valeur */
  engines?: Array<{
    llpCyclesRemaining?: number | null;
    egtMargin?: number | null;
    lastShopVisitDate?: Date | null;
  }>;

  /** Nombre d'Airworthiness Directives ouvertes */
  openAdCount?: number;

  /** Date de la prochaine visite lourde (C ou D check) */
  nextHeavyCheckDate?: Date | null;

  /** Date d'évaluation (défaut : aujourd'hui) */
  valuationDate?: Date;

  /** Conditions de marché à appliquer */
  market?: MarketConditions;
}

export interface ValuationResult {
  baseValue: number;
  currentMarketValue: number;
  residualValue: number;
  residualValueDate: Date;
  currency: 'USD';

  /** Détail du calcul — pour audit et transparence utilisateur */
  breakdown: {
    typeProfile: string;
    listPrice: number;
    ageYears: number;
    ageDepreciationPct: number;
    utilizationAdjustmentPct: number;
    maintenanceAdjustmentPct: number;
    marketAdjustmentPct: number;
    generationAdjustmentPct: number;
    floorValue: number;
  };

  /** Fiabilité de l'estimation */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceNotes: string[];

  /** Mention obligatoire à afficher */
  disclaimer: string;
}

const DISCLAIMER =
  "Estimation calculée algorithmiquement par AeroOS sur la base de paramètres de marché. " +
  "Ne constitue pas un appraisal certifié au sens des standards ISTAT/ASA.";

// ─────────────────────────────────────────────────────────────────
// Moteur de calcul
// ─────────────────────────────────────────────────────────────────

export function calculateValuation(input: ValuationInput): ValuationResult {
  const valuationDate = input.valuationDate ?? new Date();
  const market = input.market ?? DEFAULT_MARKET;
  const notes: string[] = [];

  // 1 ── Profil de l'appareil
  const typeKey = buildTypeKey(input.manufacturer, input.model, input.variant);
  const profile = AIRCRAFT_PROFILES[typeKey] ?? DEFAULT_PROFILE;

  if (!AIRCRAFT_PROFILES[typeKey]) {
    notes.push(
      `Type "${typeKey}" absent du référentiel — profil générique appliqué`
    );
  }

  const listPrice = profile.listPriceMusd * 1_000_000;

  // 2 ── Dépréciation liée à l'âge
  const ageYears = yearsBetween(
    new Date(input.yearBuilt, 0, 1),
    valuationDate
  );

  let valueFactor: number;
  if (ageYears <= 0) {
    valueFactor = 1;
  } else if (ageYears <= 1) {
    valueFactor = 1 - profile.firstYearDepreciation / 100;
  } else {
    const afterFirstYear = 1 - profile.firstYearDepreciation / 100;
    valueFactor =
      afterFirstYear *
      Math.pow(1 - profile.annualDepreciation / 100, ageYears - 1);
  }

  const ageDepreciationPct = (1 - valueFactor) * 100;

  // 3 ── Ajustement utilisation (heures/cycles vs usage typique)
  const expectedCycles = profile.typicalCyclesPerYear * ageYears;
  const expectedHours = profile.typicalHoursPerYear * ageYears;

  let utilizationAdj = 0;
  if (expectedCycles > 0 && input.totalCycles > 0) {
    const cycleRatio = input.totalCycles / expectedCycles;
    const hourRatio = expectedHours > 0 ? input.totalHours / expectedHours : 1;
    const avgRatio = (cycleRatio + hourRatio) / 2;

    // Sur-utilisation → décote ; sous-utilisation → prime (plafonnée)
    utilizationAdj = clamp((1 - avgRatio) * 8, -12, 6);

    if (avgRatio > 1.25) {
      notes.push('Utilisation nettement supérieure à la moyenne du type');
    } else if (avgRatio < 0.7) {
      notes.push('Utilisation faible — vérifier périodes de stockage');
    }
  } else {
    notes.push('Données d\'utilisation absentes — ajustement non appliqué');
  }

  // 4 ── Ajustement état de maintenance
  let maintenanceAdj = 0;

  // Moteurs : le poste le plus lourd d'un actif
  if (input.engines && input.engines.length > 0) {
    const llpValues = input.engines
      .map((e) => e.llpCyclesRemaining)
      .filter((v): v is number => v != null);

    if (llpValues.length > 0) {
      const minLlp = Math.min(...llpValues);
      // Un moteur avec < 3000 cycles LLP restants coûtera cher à remettre à niveau
      if (minLlp < 2000) {
        maintenanceAdj -= 8;
        notes.push(`LLP critique : ${minLlp} cycles restants`);
      } else if (minLlp < 5000) {
        maintenanceAdj -= 4;
        notes.push(`LLP à surveiller : ${minLlp} cycles restants`);
      } else if (minLlp > 12000) {
        maintenanceAdj += 3;
      }
    } else {
      notes.push('Statut LLP moteurs inconnu — risque non évalué');
    }

    // Marge EGT : indicateur de santé moteur
    const egtValues = input.engines
      .map((e) => e.egtMargin)
      .filter((v): v is number => v != null);
    if (egtValues.length > 0) {
      const minEgt = Math.min(...egtValues);
      if (minEgt < 15) {
        maintenanceAdj -= 5;
        notes.push(`Marge EGT faible (${minEgt}°C) — shop visit proche`);
      } else if (minEgt > 40) {
        maintenanceAdj += 2;
      }
    }
  } else {
    notes.push('Aucune donnée moteur — estimation moins fiable');
  }

  // Visite lourde imminente
  if (input.nextHeavyCheckDate) {
    const monthsToCheck = monthsBetween(valuationDate, input.nextHeavyCheckDate);
    if (monthsToCheck < 6 && monthsToCheck >= 0) {
      maintenanceAdj -= 5;
      notes.push('Visite lourde dans moins de 6 mois');
    } else if (monthsToCheck < 0) {
      maintenanceAdj -= 8;
      notes.push('Visite lourde en retard');
    }
  }

  // Airworthiness Directives ouvertes
  if (input.openAdCount && input.openAdCount > 0) {
    maintenanceAdj -= Math.min(input.openAdCount * 0.8, 5);
    if (input.openAdCount > 3) {
      notes.push(`${input.openAdCount} AD ouvertes`);
    }
  }

  maintenanceAdj = clamp(maintenanceAdj, -20, 6);

  // 5 ── Base Value (avant conditions de marché)
  let baseValue =
    listPrice * valueFactor * (1 + utilizationAdj / 100) * (1 + maintenanceAdj / 100);

  const floorValue = listPrice * (profile.floorPct / 100);
  baseValue = Math.max(baseValue, floorValue);

  // 6 ── Current Market Value (BV + conditions de marché + génération)
  const genAdj = market.generationAdjustment[profile.generation];
  const marketAdjustmentPct = (market.marketMultiplier - 1) * 100;
  const generationAdjustmentPct = (genAdj - 1) * 100;

  let currentMarketValue = baseValue * market.marketMultiplier * genAdj;
  currentMarketValue = Math.max(currentMarketValue, floorValue);

  // 7 ── Residual Value à 5 ans
  const rvDate = new Date(valuationDate);
  rvDate.setFullYear(rvDate.getFullYear() + 5);

  const futureAge = ageYears + 5;
  let futureFactor: number;
  if (futureAge <= 1) {
    futureFactor = 1 - profile.firstYearDepreciation / 100;
  } else {
    const afterFirstYear = 1 - profile.firstYearDepreciation / 100;
    futureFactor =
      afterFirstYear *
      Math.pow(1 - profile.annualDepreciation / 100, futureAge - 1);
  }

  let residualValue = listPrice * futureFactor * (1 + utilizationAdj / 100);
  residualValue = Math.max(residualValue, floorValue);

  // Au-delà de la vie économique, la valeur tend vers le plancher
  if (futureAge > profile.economicLifeYears) {
    residualValue = floorValue;
    notes.push('Projection au-delà de la vie économique du type');
  }

  // 8 ── Niveau de confiance
  const confidence = assessConfidence(input, notes, !!AIRCRAFT_PROFILES[typeKey]);

  return {
    baseValue: round2(baseValue),
    currentMarketValue: round2(currentMarketValue),
    residualValue: round2(residualValue),
    residualValueDate: rvDate,
    currency: 'USD',
    breakdown: {
      typeProfile: typeKey,
      listPrice: round2(listPrice),
      ageYears: round1(ageYears),
      ageDepreciationPct: round1(ageDepreciationPct),
      utilizationAdjustmentPct: round1(utilizationAdj),
      maintenanceAdjustmentPct: round1(maintenanceAdj),
      marketAdjustmentPct: round1(marketAdjustmentPct),
      generationAdjustmentPct: round1(generationAdjustmentPct),
      floorValue: round2(floorValue),
    },
    confidence,
    confidenceNotes: notes,
    disclaimer: DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────
// Historique de valeur (pour les courbes)
// ─────────────────────────────────────────────────────────────────

/**
 * Génère la courbe de valeur d'un actif de sa livraison à sa fin de vie.
 * Utilisé pour l'affichage graphique dans la fiche actif.
 */
export function buildValueCurve(
  input: ValuationInput,
  opts: { stepYears?: number } = {}
): Array<{ year: number; age: number; baseValue: number; marketValue: number }> {
  const step = opts.stepYears ?? 1;
  const typeKey = buildTypeKey(input.manufacturer, input.model, input.variant);
  const profile = AIRCRAFT_PROFILES[typeKey] ?? DEFAULT_PROFILE;

  const points: Array<{
    year: number; age: number; baseValue: number; marketValue: number;
  }> = [];

  for (let age = 0; age <= profile.economicLifeYears; age += step) {
    const year = input.yearBuilt + age;
    const asOf = new Date(year, 0, 1);

    // Extrapolation linéaire de l'utilisation
    const currentAge = yearsBetween(new Date(input.yearBuilt, 0, 1), new Date());
    const utilizationRatio = currentAge > 0 ? age / currentAge : 0;

    const result = calculateValuation({
      ...input,
      valuationDate: asOf,
      totalHours: Math.round(input.totalHours * utilizationRatio),
      totalCycles: Math.round(input.totalCycles * utilizationRatio),
    });

    points.push({
      year,
      age,
      baseValue: result.baseValue,
      marketValue: result.currentMarketValue,
    });
  }

  return points;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function buildTypeKey(
  manufacturer: string,
  model: string,
  variant?: string | null
): string {
  const m = model.trim();
  const v = variant?.trim() ?? '';

  // "A320" + "-200" → "A320-200" ; "A320" + "neo" → "A320neo"
  if (!v) return m;
  if (v.startsWith('-') || v.startsWith(' ')) return `${m}${v}`;
  if (/^(neo|MAX)/i.test(v)) return `${m}${v}`;
  return `${m}-${v}`;
}

function assessConfidence(
  input: ValuationInput,
  notes: string[],
  hasProfile: boolean
): 'HIGH' | 'MEDIUM' | 'LOW' {
  let score = 100;

  if (!hasProfile) score -= 30;
  if (!input.engines || input.engines.length === 0) score -= 25;
  if (!input.totalCycles || input.totalCycles === 0) score -= 20;
  if (input.hoursQuality === 'ESTIMATED') score -= 15;
  if (input.hoursQuality === 'DECLARED') score -= 5;
  if (notes.length > 3) score -= 10;

  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (30.44 * 24 * 3600 * 1000);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
