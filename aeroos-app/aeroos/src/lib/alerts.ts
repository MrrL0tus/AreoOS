/**
 * AeroOS — Moteur d'alertes
 * ═══════════════════════════════════════════════════════════════════
 *
 * Évalue l'état du portefeuille et génère les alertes actionnables.
 *
 * Conçu pour tourner :
 *   - à la demande (rafraîchissement du dashboard)
 *   - en tâche planifiée quotidienne (cron / worker)
 *
 * Principe : idempotent. Relancer le moteur ne crée pas de doublons.
 * Une alerte existante non résolue est mise à jour, pas dupliquée.
 */

import type { PrismaClient, AlertSeverity, AlertType } from '@prisma/client';
import { withTenant } from './db';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface AlertCandidate {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  aircraftId?: string;
  contractId?: string;
  dueDate?: Date;
  /** Clé de déduplication — identifie l'alerte de façon stable */
  dedupeKey: string;
}

export interface AlertRuleConfig {
  contractAlertDays: number[];
  paymentAlertDays: number[];
  insuranceAlertDays: number[];
  certificateAlertDays: number[];
  maintenanceAlertMonths: number;
  concentrationLimitPct: number;
  llpCycleThreshold: number;
}

export const DEFAULT_RULES: AlertRuleConfig = {
  contractAlertDays: [180, 90, 30, 7],
  paymentAlertDays: [3, 7, 15],
  insuranceAlertDays: [60, 30],
  certificateAlertDays: [90, 30],
  maintenanceAlertMonths: 6,
  concentrationLimitPct: 30,
  llpCycleThreshold: 3000,
};

// ─────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────

export async function evaluateAlerts(
  tenantId: string,
  config: Partial<AlertRuleConfig> = {}
): Promise<{ created: number; updated: number; resolved: number }> {
  const rules = { ...DEFAULT_RULES, ...config };

  return withTenant(tenantId, async (tx) => {
    const candidates: AlertCandidate[] = [];

    candidates.push(...(await checkContractExpiry(tx, rules)));
    candidates.push(...(await checkOverduePayments(tx, rules)));
    candidates.push(...(await checkInsuranceExpiry(tx, rules)));
    candidates.push(...(await checkCertificateExpiry(tx, rules)));
    candidates.push(...(await checkUpcomingMaintenance(tx, rules)));
    candidates.push(...(await checkConcentration(tx, rules)));
    candidates.push(...(await checkLlpThresholds(tx, rules)));
    candidates.push(...(await checkSanctionsFlags(tx)));

    return persistAlerts(tx, tenantId, candidates);
  });
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 1 — Expiration des contrats
// ─────────────────────────────────────────────────────────────────

async function checkContractExpiry(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const now = new Date();
  const maxDays = Math.max(...rules.contractAlertDays);
  const horizon = addDays(now, maxDays);

  const contracts = await tx.leaseContract.findMany({
    where: {
      status: { in: ['ACTIVE', 'SIGNED'] },
      endDate: { gte: now, lte: horizon },
      deletedAt: null,
    },
    include: {
      aircraft: { select: { id: true, msn: true, model: true, variant: true } },
      lessee: { select: { name: true } },
    },
  });

  const out: AlertCandidate[] = [];

  for (const c of contracts) {
    const daysLeft = daysBetween(now, c.endDate);
    const threshold = rules.contractAlertDays
      .filter((d) => daysLeft <= d)
      .sort((a, b) => a - b)[0];

    if (threshold === undefined) continue;

    out.push({
      type: 'CONTRACT_EXPIRY',
      severity:
        daysLeft <= 30 ? 'CRITICAL' : daysLeft <= 90 ? 'HIGH' : 'MEDIUM',
      title: `Contrat ${c.reference} expire dans ${daysLeft} jours`,
      message:
        `${c.aircraft.model}${c.aircraft.variant ?? ''} MSN ${c.aircraft.msn} ` +
        `loué à ${c.lessee.name}. Fin de bail : ${fmtDate(c.endDate)}. ` +
        `Décider : renouvellement, remarketing ou vente.`,
      aircraftId: c.aircraftId,
      contractId: c.id,
      dueDate: c.endDate,
      dedupeKey: `contract-expiry:${c.id}:${threshold}`,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 2 — Loyers impayés
// ─────────────────────────────────────────────────────────────────

async function checkOverduePayments(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const now = new Date();

  const payments = await tx.payment.findMany({
    where: {
      status: { in: ['DUE', 'SCHEDULED', 'PARTIAL', 'OVERDUE'] },
      dueDate: { lt: now },
      receivedDate: null,
      deletedAt: null,
    },
    include: {
      contract: {
        include: {
          aircraft: { select: { id: true, msn: true, model: true } },
          lessee: { select: { name: true } },
        },
      },
    },
  });

  const out: AlertCandidate[] = [];

  for (const p of payments) {
    const daysLate = daysBetween(p.dueDate, now);
    const threshold = rules.paymentAlertDays
      .filter((d) => daysLate >= d)
      .sort((a, b) => b - a)[0];

    if (threshold === undefined) continue;

    out.push({
      type: 'PAYMENT_OVERDUE',
      severity:
        daysLate >= 15 ? 'CRITICAL' : daysLate >= 7 ? 'HIGH' : 'MEDIUM',
      title: `Loyer ${p.periodLabel} en retard de ${daysLate} jours`,
      message:
        `${p.contract.lessee.name} — MSN ${p.contract.aircraft.msn}. ` +
        `Montant dû : ${fmtMoney(Number(p.amountDue), p.currency)}. ` +
        `Échéance : ${fmtDate(p.dueDate)}.`,
      aircraftId: p.contract.aircraftId,
      contractId: p.contractId,
      dueDate: p.dueDate,
      dedupeKey: `payment-overdue:${p.id}:${threshold}`,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 3 — Assurance expirante
// ─────────────────────────────────────────────────────────────────

async function checkInsuranceExpiry(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const now = new Date();
  const horizon = addDays(now, Math.max(...rules.insuranceAlertDays));

  const aircraft = await tx.aircraft.findMany({
    where: {
      insuranceExpiryDate: { gte: now, lte: horizon },
      status: { notIn: ['SOLD', 'PARTED_OUT'] },
      deletedAt: null,
    },
    select: {
      id: true, msn: true, model: true, variant: true,
      insuranceExpiryDate: true,
    },
  });

  return aircraft
    .filter((a) => a.insuranceExpiryDate)
    .map((a) => {
      const daysLeft = daysBetween(now, a.insuranceExpiryDate!);
      const threshold = rules.insuranceAlertDays
        .filter((d) => daysLeft <= d)
        .sort((x, y) => x - y)[0];
      if (threshold === undefined) return null;

      return {
        type: 'INSURANCE_EXPIRY' as AlertType,
        severity: (daysLeft <= 30 ? 'HIGH' : 'MEDIUM') as AlertSeverity,
        title: `Assurance MSN ${a.msn} expire dans ${daysLeft} jours`,
        message:
          `${a.model}${a.variant ?? ''} — certificat d'assurance à renouveler ` +
          `avant le ${fmtDate(a.insuranceExpiryDate!)}.`,
        aircraftId: a.id,
        dueDate: a.insuranceExpiryDate!,
        dedupeKey: `insurance:${a.id}:${threshold}`,
      };
    })
    .filter((x): x is AlertCandidate => x !== null);
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 4 — Certificats de navigabilité
// ─────────────────────────────────────────────────────────────────

async function checkCertificateExpiry(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const now = new Date();
  const horizon = addDays(now, Math.max(...rules.certificateAlertDays));

  const aircraft = await tx.aircraft.findMany({
    where: {
      OR: [
        { cofaExpiryDate: { gte: now, lte: horizon } },
        { cofrExpiryDate: { gte: now, lte: horizon } },
      ],
      status: { notIn: ['SOLD', 'PARTED_OUT'] },
      deletedAt: null,
    },
    select: {
      id: true, msn: true, model: true,
      cofaExpiryDate: true, cofrExpiryDate: true,
    },
  });

  const out: AlertCandidate[] = [];

  for (const a of aircraft) {
    for (const [label, date] of [
      ['CofA', a.cofaExpiryDate],
      ['CofR', a.cofrExpiryDate],
    ] as const) {
      if (!date || date < now || date > horizon) continue;

      const daysLeft = daysBetween(now, date);
      const threshold = rules.certificateAlertDays
        .filter((d) => daysLeft <= d)
        .sort((x, y) => x - y)[0];
      if (threshold === undefined) continue;

      out.push({
        type: 'CERTIFICATE_EXPIRY',
        severity: daysLeft <= 30 ? 'HIGH' : 'MEDIUM',
        title: `${label} MSN ${a.msn} expire dans ${daysLeft} jours`,
        message:
          `${a.model} — ${label} à renouveler avant le ${fmtDate(date)}. ` +
          `Un certificat expiré immobilise l'appareil.`,
        aircraftId: a.id,
        dueDate: date,
        dedupeKey: `certificate:${a.id}:${label}:${threshold}`,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 5 — Maintenance à venir
// ─────────────────────────────────────────────────────────────────

async function checkUpcomingMaintenance(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const now = new Date();
  const horizon = addMonths(now, rules.maintenanceAlertMonths);

  const tasks = await tx.maintenanceTask.findMany({
    where: {
      status: { in: ['PLANNED', 'SCHEDULED'] },
      dueDate: { gte: now, lte: horizon },
      deletedAt: null,
    },
    include: {
      aircraft: { select: { id: true, msn: true, model: true } },
    },
  });

  return tasks
    .filter((t) => t.dueDate)
    .map((t) => {
      const daysLeft = daysBetween(now, t.dueDate!);
      const isHeavy = ['C_CHECK', 'D_CHECK', 'ENGINE_SHOP_VISIT'].includes(
        t.type
      );

      return {
        type: 'MAINTENANCE_DUE' as AlertType,
        severity: (daysLeft <= 30 && isHeavy
          ? 'HIGH'
          : 'MEDIUM') as AlertSeverity,
        title: `${humanizeMaintenanceType(t.type)} — MSN ${t.aircraft.msn}`,
        message:
          `Prévue le ${fmtDate(t.dueDate!)} (dans ${daysLeft} jours). ` +
          (t.estimatedCost
            ? `Coût estimé : ${fmtMoney(Number(t.estimatedCost), t.currency)}. `
            : '') +
          (t.mroName ? `MRO : ${t.mroName}.` : 'MRO à confirmer.'),
        aircraftId: t.aircraftId,
        dueDate: t.dueDate!,
        dedupeKey: `maintenance:${t.id}`,
      };
    });
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 6 — Concentration par locataire
// ─────────────────────────────────────────────────────────────────

async function checkConcentration(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const contracts = await tx.leaseContract.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    include: {
      lessee: { select: { id: true, name: true } },
      aircraft: {
        select: {
          id: true,
          valuations: {
            orderBy: { valuationDate: 'desc' },
            take: 1,
            select: { baseValue: true },
          },
        },
      },
    },
  });

  if (contracts.length === 0) return [];

  const byLessee = new Map<string, { name: string; value: number }>();
  let totalValue = 0;

  for (const c of contracts) {
    const v = Number(c.aircraft.valuations[0]?.baseValue ?? 0);
    totalValue += v;
    const existing = byLessee.get(c.lesseeId);
    byLessee.set(c.lesseeId, {
      name: c.lessee.name,
      value: (existing?.value ?? 0) + v,
    });
  }

  if (totalValue === 0) return [];

  const out: AlertCandidate[] = [];

  for (const [lesseeId, data] of byLessee) {
    const pct = (data.value / totalValue) * 100;
    if (pct > rules.concentrationLimitPct) {
      out.push({
        type: 'CONCENTRATION_BREACH',
        severity: pct > rules.concentrationLimitPct + 10 ? 'HIGH' : 'MEDIUM',
        title: `Concentration ${data.name} : ${pct.toFixed(1)}%`,
        message:
          `${data.name} représente ${pct.toFixed(1)}% de la valeur du ` +
          `portefeuille, au-dessus de la limite de ${rules.concentrationLimitPct}%. ` +
          `Envisager une diversification lors des prochains placements.`,
        dedupeKey: `concentration:${lesseeId}`,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 7 — Seuils LLP moteurs
// ─────────────────────────────────────────────────────────────────

async function checkLlpThresholds(
  tx: TxClient,
  rules: AlertRuleConfig
): Promise<AlertCandidate[]> {
  const engines = await tx.engine.findMany({
    where: {
      llpCyclesRemaining: { lte: rules.llpCycleThreshold, gt: 0 },
      aircraftId: { not: null },
      deletedAt: null,
    },
    include: {
      aircraft: { select: { id: true, msn: true, model: true } },
    },
  });

  return engines.map((e) => ({
    type: 'LLP_THRESHOLD' as AlertType,
    severity: (e.llpCyclesRemaining! < 1500
      ? 'CRITICAL'
      : 'HIGH') as AlertSeverity,
    title: `LLP moteur ${e.serialNumber} : ${e.llpCyclesRemaining} cycles`,
    message:
      `${e.model} sur MSN ${e.aircraft?.msn}. ` +
      `Pièce limitante : ${e.llpLimitingPart ?? 'non précisée'}. ` +
      `Un remplacement LLP coûte typiquement plusieurs millions — ` +
      `impact direct sur la valeur de l'actif.`,
    aircraftId: e.aircraftId!,
    dedupeKey: `llp:${e.id}`,
  }));
}

// ─────────────────────────────────────────────────────────────────
// RÈGLE 8 — Contreparties signalées (sanctions)
// ─────────────────────────────────────────────────────────────────

async function checkSanctionsFlags(tx: TxClient): Promise<AlertCandidate[]> {
  const operators = await tx.operator.findMany({
    where: {
      sanctionsStatus: { in: ['FLAGGED', 'BLOCKED'] },
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true, name: true, country: true, sanctionsStatus: true,
      sanctionsCheckedAt: true,
    },
  });

  return operators.map((o) => ({
    type: 'SANCTIONS_FLAG' as AlertType,
    severity: 'CRITICAL' as AlertSeverity,
    title:
      o.sanctionsStatus === 'BLOCKED'
        ? `⛔ ${o.name} — entité sanctionnée`
        : `⚠️ ${o.name} — correspondance sanctions à vérifier`,
    message:
      o.sanctionsStatus === 'BLOCKED'
        ? `${o.name} (${o.country}) figure sur une liste de sanctions. ` +
          `Toute transaction est interdite. Consulter le conseil juridique immédiatement.`
        : `${o.name} (${o.country}) présente une correspondance possible avec ` +
          `une liste de sanctions. Révision humaine requise avant toute opération.`,
    dedupeKey: `sanctions:${o.id}:${o.sanctionsStatus}`,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Persistance idempotente
// ─────────────────────────────────────────────────────────────────

async function persistAlerts(
  tx: TxClient,
  tenantId: string,
  candidates: AlertCandidate[]
): Promise<{ created: number; updated: number; resolved: number }> {
  const existing = await tx.alert.findMany({
    where: { resolvedAt: null, deletedAt: null },
  });

  const existingByKey = new Map(
    existing.map((a) => [extractDedupeKey(a.message, a.type, a.aircraftId), a])
  );

  let created = 0;
  let updated = 0;

  const activeKeys = new Set(candidates.map((c) => c.dedupeKey));

  for (const c of candidates) {
    const match = existing.find(
      (a) =>
        a.type === c.type &&
        a.aircraftId === (c.aircraftId ?? null) &&
        a.contractId === (c.contractId ?? null) &&
        a.title === c.title
    );

    if (match) {
      if (match.message !== c.message || match.severity !== c.severity) {
        await tx.alert.update({
          where: { id: match.id },
          data: { message: c.message, severity: c.severity },
        });
        updated++;
      }
    } else {
      await tx.alert.create({
        data: {
          tenantId,
          type: c.type,
          severity: c.severity,
          title: c.title,
          message: c.message,
          aircraftId: c.aircraftId,
          contractId: c.contractId,
          dueDate: c.dueDate,
        },
      });
      created++;
    }
  }

  // Résout les alertes dont la condition n'est plus remplie
  const stillValidTitles = new Set(candidates.map((c) => c.title));
  const toResolve = existing.filter((a) => !stillValidTitles.has(a.title));

  if (toResolve.length > 0) {
    await tx.alert.updateMany({
      where: { id: { in: toResolve.map((a) => a.id) } },
      data: { resolvedAt: new Date(), resolvedBy: 'SYSTEM_AUTO_RESOLVE' },
    });
  }

  return { created, updated, resolved: toResolve.length };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

function extractDedupeKey(
  _message: string,
  type: string,
  aircraftId: string | null
): string {
  return `${type}:${aircraftId ?? 'none'}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

function fmtMoney(v: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(v);
}

function humanizeMaintenanceType(t: string): string {
  const map: Record<string, string> = {
    A_CHECK: 'A-Check',
    C_CHECK: 'C-Check',
    D_CHECK: 'D-Check',
    ENGINE_SHOP_VISIT: 'Engine Shop Visit',
    APU_OVERHAUL: 'Révision APU',
    LANDING_GEAR_OVERHAUL: 'Révision train',
    AD_COMPLIANCE: 'Mise en conformité AD',
    SB_INCORPORATION: 'Application SB',
    OTHER: 'Maintenance',
  };
  return map[t] ?? t;
}
