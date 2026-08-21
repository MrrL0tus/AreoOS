/**
 * AeroOS — Données de démonstration
 * ═══════════════════════════════════════════════════════════════════
 *
 * Crée un portefeuille réaliste de 12 appareils avec contrats, moteurs,
 * historique, maintenance et documents.
 *
 * Les données sont fictives mais cohérentes : les MSN, immatriculations,
 * heures de vol, cycles et valeurs correspondent à ce qu'on observe
 * réellement sur ce type de flotte.
 *
 *   npm run db:seed
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { calculateValuation } from '../src/lib/valuation';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const d = (s: string) => new Date(s);
const dec = (n: number) => new Prisma.Decimal(n);

function monthsAgo(n: number): Date {
  const r = new Date();
  r.setMonth(r.getMonth() - n);
  return r;
}

function monthsAhead(n: number): Date {
  const r = new Date();
  r.setMonth(r.getMonth() + n);
  return r;
}

function daysAhead(n: number): Date {
  const r = new Date();
  r.setDate(r.getDate() + n);
  return r;
}

function daysAgo(n: number): Date {
  const r = new Date();
  r.setDate(r.getDate() - n);
  return r;
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('🌱 AeroOS — génération des données de démonstration\n');

  // ── Nettoyage ──
  console.log('   Nettoyage de la base…');
  await prisma.auditLog.deleteMany();
  await prisma.aiExtraction.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.assetEvent.deleteMany();
  await prisma.maintenanceTask.deleteMany();
  await prisma.valuationRecord.deleteMany();
  await prisma.document.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.leaseContract.deleteMany();
  await prisma.component.deleteMany();
  await prisma.engine.deleteMany();
  await prisma.aircraft.deleteMany();
  await prisma.portfolio.deleteMany();
  await prisma.operator.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  // ─────────────────────────────────────────────────────────────
  // TENANT
  // ─────────────────────────────────────────────────────────────
  const tenantId = randomUUID();
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'Meridian Aviation Capital',
      legalName: 'Meridian Aviation Capital Ltd.',
      plan: 'PROFESSIONAL',
      storageRegion: 'EU_WEST_1',
      baseCurrency: 'USD',
      maxAssets: 50,
      maxUsers: 10,
      concentrationLimitPct: 30,
    },
  });
  console.log(`   ✓ Tenant : ${tenant.name}`);

  // ─────────────────────────────────────────────────────────────
  // UTILISATEURS
  // ─────────────────────────────────────────────────────────────
  const pwd = await bcrypt.hash('demo1234', 10);

  const admin = await prisma.user.create({
    data: {
      tenantId, email: 'admin@meridian-aviation.com', passwordHash: pwd,
      firstName: 'Claire', lastName: 'Fontaine', role: 'ADMIN',
      mfaEnabled: false, lastLoginAt: daysAgo(0),
    },
  });

  await prisma.user.createMany({
    data: [
      { tenantId, email: 'jm.dubois@meridian-aviation.com', passwordHash: pwd,
        firstName: 'Jean-Marc', lastName: 'Dubois', role: 'MANAGER' },
      { tenantId, email: 'analyst@meridian-aviation.com', passwordHash: pwd,
        firstName: 'Sofia', lastName: 'Ricci', role: 'ANALYST' },
    ],
  });
  console.log('   ✓ 3 utilisateurs (admin@meridian-aviation.com / demo1234)');

  // ─────────────────────────────────────────────────────────────
  // PORTFOLIO
  // ─────────────────────────────────────────────────────────────
  const portfolio = await prisma.portfolio.create({
    data: {
      tenantId, name: 'Meridian Fund I',
      description: 'Portefeuille narrowbody européen — génération ceo et neo',
      currency: 'USD', ownerName: 'Meridian Aviation Capital Ltd.',
      targetYieldPct: 8.5, inceptionDate: d('2018-06-01'),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // OPÉRATEURS
  // ─────────────────────────────────────────────────────────────
  const ops = await Promise.all([
    prisma.operator.create({ data: {
      tenantId, name: 'Aurora Airlines', legalName: 'Aurora Airlines S.A.',
      iataCode: 'AU', icaoCode: 'AUA', country: 'France', region: 'Europe',
      creditRating: 'BBB', riskScore: 34, riskUpdatedAt: daysAgo(12),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(12),
    }}),
    prisma.operator.create({ data: {
      tenantId, name: 'Iberavia', legalName: 'Iberavia Lineas Aereas S.A.',
      iataCode: 'IB', icaoCode: 'IBV', country: 'Espagne', region: 'Europe',
      creditRating: 'BB+', riskScore: 48, riskUpdatedAt: daysAgo(20),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(20),
    }}),
    prisma.operator.create({ data: {
      tenantId, name: 'Lusitana Air', legalName: 'Lusitana Air S.A.',
      iataCode: 'LU', icaoCode: 'LUS', country: 'Portugal', region: 'Europe',
      creditRating: 'BB-', riskScore: 71, riskUpdatedAt: daysAgo(5),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(5),
      sanctionsNotes: 'Score de risque en hausse — surveiller les paiements',
    }}),
    prisma.operator.create({ data: {
      tenantId, name: 'Nordwind Express', legalName: 'Nordwind Express GmbH',
      iataCode: 'NW', icaoCode: 'NWX', country: 'Allemagne', region: 'Europe',
      creditRating: 'A-', riskScore: 22, riskUpdatedAt: daysAgo(30),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(30),
    }}),
    prisma.operator.create({ data: {
      tenantId, name: 'Alpine Connect', legalName: 'Alpine Connect AG',
      iataCode: 'AC', icaoCode: 'ALC', country: 'Autriche', region: 'Europe',
      creditRating: 'BBB+', riskScore: 28, riskUpdatedAt: daysAgo(45),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(45),
    }}),
    prisma.operator.create({ data: {
      tenantId, name: 'Britannia Regional', legalName: 'Britannia Regional Ltd.',
      iataCode: 'BR', icaoCode: 'BRG', country: 'Royaume-Uni', region: 'Europe',
      creditRating: 'BB', riskScore: 55, riskUpdatedAt: daysAgo(18),
      sanctionsStatus: 'CLEAR', sanctionsCheckedAt: daysAgo(18),
    }}),
  ]);
  const [aurora, iberavia, lusitana, nordwind, alpine, britannia] = ops;
  console.log(`   ✓ ${ops.length} opérateurs`);

  // ─────────────────────────────────────────────────────────────
  // FLOTTE
  // ─────────────────────────────────────────────────────────────
  interface FleetSpec {
    msn: string; reg: string | null; mfr: string; model: string;
    variant: string; year: number; hours: number; cycles: number;
    seats: number; cabin: string; status: any; operator: any;
    engineModel: string; engineMfr: string; engineSerials: [string, string];
    egt: [number, number]; llp: [number, number]; llpPart: string;
    cofa?: Date | null; insurance?: Date | null; openAd: number;
    lastShopVisit?: Date | null; nextShopVisit?: Date | null;
  }

  const fleet: FleetSpec[] = [
    { msn: '45812', reg: 'F-HMAA', mfr: 'Airbus', model: 'A320', variant: '-200',
      year: 2011, hours: 28450, cycles: 19230, seats: 174, cabin: '174Y',
      status: 'ON_LEASE', operator: aurora,
      engineModel: 'CFM56-5B4', engineMfr: 'CFM International',
      engineSerials: ['CFM-781422', 'CFM-802115'], egt: [42, 38],
      llp: [8400, 9100], llpPart: 'HPT Stage 1 Disk',
      cofa: daysAhead(168), insurance: daysAhead(212), openAd: 3,
      lastShopVisit: d('2022-03-15'), nextShopVisit: d('2027-06-01') },

    { msn: '38291', reg: 'EC-MZK', mfr: 'Boeing', model: 'B737', variant: '-800',
      year: 2012, hours: 34810, cycles: 27650, seats: 189, cabin: '189Y',
      status: 'ON_LEASE', operator: iberavia,
      engineModel: 'CFM56-7B27', engineMfr: 'CFM International',
      engineSerials: ['CFM-891203', 'CFM-891455'], egt: [19, 24],
      llp: [2800, 3400], llpPart: 'HPT Stage 2 Disk',
      cofa: daysAhead(310), insurance: daysAhead(95), openAd: 5,
      lastShopVisit: d('2019-08-20'), nextShopVisit: d('2025-11-01') },

    { msn: '51204', reg: 'CS-TLV', mfr: 'Airbus', model: 'A320', variant: '-200',
      year: 2014, hours: 21340, cycles: 14890, seats: 180, cabin: '180Y',
      status: 'ON_LEASE', operator: lusitana,
      engineModel: 'CFM56-5B4', engineMfr: 'CFM International',
      engineSerials: ['CFM-914288', 'CFM-914301'], egt: [51, 47],
      llp: [11200, 10800], llpPart: 'LPT Stage 3 Disk',
      cofa: daysAhead(420), insurance: daysAhead(28), openAd: 1,
      lastShopVisit: null, nextShopVisit: d('2028-03-01') },

    { msn: '47801', reg: 'D-ANWB', mfr: 'Airbus', model: 'A321', variant: '-200',
      year: 2015, hours: 19200, cycles: 13100, seats: 220, cabin: '220Y',
      status: 'ON_LEASE', operator: nordwind,
      engineModel: 'CFM56-5B3', engineMfr: 'CFM International',
      engineSerials: ['CFM-935610', 'CFM-935722'], egt: [55, 53],
      llp: [13400, 13900], llpPart: 'HPC Stage 9 Disk',
      cofa: daysAhead(520), insurance: daysAhead(340), openAd: 0,
      lastShopVisit: null, nextShopVisit: d('2029-01-01') },

    { msn: '52018', reg: 'OE-LAC', mfr: 'Airbus', model: 'A320', variant: 'neo',
      year: 2021, hours: 8420, cycles: 5930, seats: 180, cabin: '180Y',
      status: 'ON_LEASE', operator: alpine,
      engineModel: 'LEAP-1A26', engineMfr: 'CFM International',
      engineSerials: ['LEAP-220841', 'LEAP-220866'], egt: [72, 69],
      llp: [19600, 19400], llpPart: 'HPT Stage 1 Disk',
      cofa: daysAhead(680), insurance: daysAhead(455), openAd: 0,
      lastShopVisit: null, nextShopVisit: d('2032-01-01') },

    { msn: '49310', reg: null, mfr: 'Boeing', model: 'B737', variant: '-800',
      year: 2009, hours: 41200, cycles: 33800, seats: 189, cabin: '189Y',
      status: 'OFF_LEASE', operator: null,
      engineModel: 'CFM56-7B26', engineMfr: 'CFM International',
      engineSerials: ['CFM-772104', 'CFM-772890'], egt: [14, 17],
      llp: [1400, 2100], llpPart: 'HPT Stage 1 Disk',
      cofa: null, insurance: daysAhead(60), openAd: 7,
      lastShopVisit: d('2018-05-10'), nextShopVisit: d('2025-09-01') },

    { msn: '53412', reg: 'G-BRTA', mfr: 'Airbus', model: 'A319', variant: '-100',
      year: 2010, hours: 37600, cycles: 28900, seats: 156, cabin: '156Y',
      status: 'ON_LEASE', operator: britannia,
      engineModel: 'CFM56-5B5', engineMfr: 'CFM International',
      engineSerials: ['CFM-756033', 'CFM-756190'], egt: [28, 31],
      llp: [5200, 5800], llpPart: 'LPT Stage 4 Disk',
      cofa: daysAhead(240), insurance: daysAhead(180), openAd: 2,
      lastShopVisit: d('2021-11-05'), nextShopVisit: d('2026-08-01') },

    { msn: '54120', reg: 'F-HMAB', mfr: 'Airbus', model: 'A321', variant: 'neo',
      year: 2022, hours: 6100, cycles: 3800, seats: 232, cabin: '232Y',
      status: 'ON_LEASE', operator: aurora,
      engineModel: 'LEAP-1A32', engineMfr: 'CFM International',
      engineSerials: ['LEAP-241055', 'LEAP-241072'], egt: [78, 76],
      llp: [21400, 21600], llpPart: 'HPT Stage 1 Disk',
      cofa: daysAhead(740), insurance: daysAhead(500), openAd: 0,
      lastShopVisit: null, nextShopVisit: d('2033-06-01') },

    { msn: '41055', reg: 'EC-NRJ', mfr: 'Boeing', model: 'B737', variant: '-800',
      year: 2016, hours: 22800, cycles: 17400, seats: 189, cabin: '189Y',
      status: 'ON_LEASE', operator: iberavia,
      engineModel: 'CFM56-7B27', engineMfr: 'CFM International',
      engineSerials: ['CFM-948201', 'CFM-948377'], egt: [46, 44],
      llp: [10600, 11100], llpPart: 'HPC Stage 9 Disk',
      cofa: daysAhead(390), insurance: daysAhead(275), openAd: 1,
      lastShopVisit: null, nextShopVisit: d('2029-04-01') },

    { msn: '50877', reg: 'D-ANWC', mfr: 'Airbus', model: 'A320', variant: '-200',
      year: 2013, hours: 25900, cycles: 18100, seats: 180, cabin: '180Y',
      status: 'IN_MAINTENANCE', operator: nordwind,
      engineModel: 'CFM56-5B4', engineMfr: 'CFM International',
      engineSerials: ['CFM-903112', 'CFM-903455'], egt: [33, 36],
      llp: [7100, 7600], llpPart: 'LPT Stage 3 Disk',
      cofa: daysAhead(150), insurance: daysAhead(320), openAd: 4,
      lastShopVisit: d('2020-09-12'), nextShopVisit: d('2026-02-01') },

    { msn: '55301', reg: 'OE-LAD', mfr: 'Airbus', model: 'A320', variant: 'neo',
      year: 2023, hours: 3900, cycles: 2600, seats: 180, cabin: '180Y',
      status: 'ON_LEASE', operator: alpine,
      engineModel: 'LEAP-1A26', engineMfr: 'CFM International',
      engineSerials: ['LEAP-251190', 'LEAP-251204'], egt: [81, 79],
      llp: [22800, 22900], llpPart: 'HPT Stage 1 Disk',
      cofa: daysAhead(820), insurance: daysAhead(610), openAd: 0,
      lastShopVisit: null, nextShopVisit: d('2034-01-01') },

    { msn: '39442', reg: 'G-BRTB', mfr: 'Boeing', model: 'B737', variant: '-700',
      year: 2008, hours: 44100, cycles: 36200, seats: 148, cabin: '148Y',
      status: 'IN_TRANSITION', operator: null,
      engineModel: 'CFM56-7B24', engineMfr: 'CFM International',
      engineSerials: ['CFM-741822', 'CFM-742019'], egt: [12, 15],
      llp: [900, 1600], llpPart: 'HPT Stage 1 Disk',
      cofa: daysAhead(45), insurance: daysAhead(40), openAd: 6,
      lastShopVisit: d('2017-03-22'), nextShopVisit: d('2025-08-15') },
  ];

  const createdAircraft: Array<{ id: string; spec: FleetSpec }> = [];

  for (const s of fleet) {
    const ac = await prisma.aircraft.create({
      data: {
        tenantId, msn: s.msn, registration: s.reg,
        manufacturer: s.mfr, model: s.model, variant: s.variant,
        yearBuilt: s.year, deliveryDate: d(`${s.year}-06-15`),
        totalHours: s.hours, totalCycles: s.cycles,
        hoursQuality: 'CERTIFIED', lastUtilizationUpdate: daysAgo(3),
        cabinConfig: s.cabin, seatCount: s.seats,
        mtowKg: s.model === 'A321' ? 93500 : s.model === 'A319' ? 75500 : 79000,
        status: s.status,
        currentOperatorId: s.operator?.id ?? null,
        cofaExpiryDate: s.cofa ?? null,
        cofrExpiryDate: s.cofa ? daysAhead(600) : null,
        insuranceExpiryDate: s.insurance ?? null,
        openAdCount: s.openAd,
        openSbCount: Math.floor(s.openAd * 2.5),
        portfolioId: portfolio.id,
      },
    });

    // Moteurs
    for (let i = 0; i < 2; i++) {
      await prisma.engine.create({
        data: {
          tenantId, serialNumber: s.engineSerials[i],
          manufacturer: s.engineMfr, model: s.engineModel,
          aircraftId: ac.id, position: i === 0 ? 'LEFT' : 'RIGHT',
          totalHours: Math.round(s.hours * (0.92 + i * 0.05)),
          totalCycles: Math.round(s.cycles * (0.92 + i * 0.05)),
          egtMargin: s.egt[i], llpCyclesRemaining: s.llp[i],
          llpLimitingPart: s.llpPart,
          lastShopVisitDate: s.lastShopVisit,
          nextShopVisitEstimate: s.nextShopVisit,
          shopVisitCostEstimate: dec(s.engineModel.startsWith('LEAP') ? 3200000 : 2400000),
          dataQuality: 'CERTIFIED',
        },
      });
    }

    // APU + trains
    await prisma.component.create({
      data: {
        tenantId, type: 'APU',
        partNumber: s.mfr === 'Airbus' ? 'APS3200' : '131-9B',
        serialNumber: `APU-${s.msn}`,
        manufacturer: s.mfr === 'Airbus' ? 'Honeywell' : 'Honeywell',
        aircraftId: ac.id, installedAt: d(`${s.year}-06-15`),
        totalHours: Math.round(s.hours * 0.6),
        totalCycles: Math.round(s.cycles * 0.8),
        nextOverhaulDue: monthsAhead(18 + Math.floor(Math.random() * 24)),
        overhaulCostEstimate: dec(180000), dataQuality: 'CERTIFIED',
      },
    });

    await prisma.component.create({
      data: {
        tenantId, type: 'Landing Gear',
        partNumber: `LG-${s.model}`, serialNumber: `LG-${s.msn}`,
        aircraftId: ac.id, installedAt: d(`${s.year}-06-15`),
        totalCycles: s.cycles,
        nextOverhaulDue: monthsAhead(24 + Math.floor(Math.random() * 36)),
        overhaulCostEstimate: dec(650000), dataQuality: 'CERTIFIED',
      },
    });

    createdAircraft.push({ id: ac.id, spec: s });
  }
  console.log(`   ✓ ${fleet.length} appareils + ${fleet.length * 2} moteurs + composants`);

  // ─────────────────────────────────────────────────────────────
  // CONTRATS + PAIEMENTS
  // ─────────────────────────────────────────────────────────────
  const contractSpecs = [
    { msn: '45812', op: aurora,   rent: 285000, start: '2019-01-15', endMonths: 5,   status: 'ACTIVE' },
    { msn: '38291', op: iberavia, rent: 232000, start: '2018-04-01', endMonths: 1.5, status: 'ACTIVE' },
    { msn: '51204', op: lusitana, rent: 268000, start: '2021-03-10', endMonths: 20,  status: 'ACTIVE' },
    { msn: '47801', op: nordwind, rent: 341000, start: '2022-06-01', endMonths: 34,  status: 'ACTIVE' },
    { msn: '52018', op: alpine,   rent: 398000, start: '2023-09-01', endMonths: 62,  status: 'ACTIVE' },
    { msn: '53412', op: britannia,rent: 176000, start: '2020-04-20', endMonths: 8,   status: 'ACTIVE' },
    { msn: '54120', op: aurora,   rent: 445000, start: '2023-02-01', endMonths: 78,  status: 'ACTIVE' },
    { msn: '41055', op: iberavia, rent: 291000, start: '2021-11-01', endMonths: 41,  status: 'ACTIVE' },
    { msn: '50877', op: nordwind, rent: 254000, start: '2020-07-15', endMonths: 15,  status: 'ACTIVE' },
    { msn: '55301', op: alpine,   rent: 421000, start: '2024-01-15', endMonths: 89,  status: 'ACTIVE' },
  ];

  let contractCount = 0;
  let paymentCount = 0;

  for (const cs of contractSpecs) {
    const ac = createdAircraft.find((a) => a.spec.msn === cs.msn)!;
    const startDate = d(cs.start);
    const endDate = monthsAhead(cs.endMonths);

    const contract = await prisma.leaseContract.create({
      data: {
        tenantId,
        reference: `MAC-${cs.msn}-${startDate.getFullYear()}`,
        aircraftId: ac.id,
        lessorName: 'Meridian Aviation Capital Ltd.',
        lesseeId: cs.op.id,
        signedDate: new Date(startDate.getTime() - 30 * 24 * 3600 * 1000),
        startDate, endDate,
        deliveryDate: startDate,
        currency: 'USD',
        monthlyRent: dec(cs.rent),
        securityDeposit: dec(cs.rent * 2),
        escalationClause: 'SOFR + 1.85%',
        mrEngineLeft: dec(Math.round(cs.rent * 0.17)),
        mrEngineRight: dec(Math.round(cs.rent * 0.17)),
        mrApu: dec(Math.round(cs.rent * 0.018)),
        mrLandingGear: dec(Math.round(cs.rent * 0.025)),
        mrAirframe: dec(Math.round(cs.rent * 0.06)),
        governingLaw: 'Irish law',
        jurisdiction: 'Dublin High Court',
        hasPurchaseOption: cs.endMonths > 60,
        hasExtensionOption: true,
        returnConditions:
          'Half-life engines, full C-Check, paint per lessor spec, ' +
          'all AD closed, complete records package.',
        status: cs.status as any,
        version: 1,
      },
    });
    contractCount++;

    // Paiements : 8 passés + 4 futurs
    for (let i = -8; i <= 4; i++) {
      const due = new Date();
      due.setMonth(due.getMonth() + i);
      due.setDate(1);

      let status: any;
      let receivedDate: Date | null = null;
      let amountReceived: Prisma.Decimal | null = null;

      if (i < 0) {
        // Lusitana : deux impayés récents (scénario de démo)
        const isLusitanaLate = cs.op.id === lusitana.id && i >= -2;
        if (isLusitanaLate) {
          status = 'OVERDUE';
        } else {
          status = 'RECEIVED';
          receivedDate = new Date(due);
          receivedDate.setDate(due.getDate() + Math.floor(Math.random() * 4) - 1);
          amountReceived = dec(cs.rent);
        }
      } else if (i === 0) {
        status = due < new Date() ? 'DUE' : 'SCHEDULED';
      } else {
        status = 'SCHEDULED';
      }

      await prisma.payment.create({
        data: {
          tenantId, contractId: contract.id,
          periodLabel: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`,
          dueDate: due, amountDue: dec(cs.rent), currency: 'USD',
          receivedDate, amountReceived, status,
        },
      });
      paymentCount++;
    }
  }
  console.log(`   ✓ ${contractCount} contrats + ${paymentCount} échéances`);

  // ─────────────────────────────────────────────────────────────
  // VALORISATIONS
  // ─────────────────────────────────────────────────────────────
  let valuationCount = 0;

  for (const { id, spec } of createdAircraft) {
    const engines = [
      { llpCyclesRemaining: spec.llp[0], egtMargin: spec.egt[0], lastShopVisitDate: spec.lastShopVisit ?? null },
      { llpCyclesRemaining: spec.llp[1], egtMargin: spec.egt[1], lastShopVisitDate: spec.lastShopVisit ?? null },
    ];

    // Historique : 6 points sur 18 mois
    for (let m = 15; m >= 0; m -= 3) {
      const valDate = monthsAgo(m);
      const result = calculateValuation({
        manufacturer: spec.mfr, model: spec.model, variant: spec.variant,
        yearBuilt: spec.year,
        totalHours: Math.round(spec.hours * (1 - m * 0.004)),
        totalCycles: Math.round(spec.cycles * (1 - m * 0.004)),
        hoursQuality: 'CERTIFIED',
        engines, openAdCount: spec.openAd,
        nextHeavyCheckDate: spec.nextShopVisit ?? null,
        valuationDate: valDate,
      });

      await prisma.valuationRecord.create({
        data: {
          tenantId, aircraftId: id, valuationDate: valDate, currency: 'USD',
          baseValue: dec(result.baseValue),
          currentMarketValue: dec(result.currentMarketValue),
          residualValue: dec(result.residualValue),
          residualValueDate: result.residualValueDate,
          method: m === 0 ? 'ALGORITHMIC' : 'ALGORITHMIC',
          source: 'AeroOS Valuation Engine v1',
          isCertified: false,
          calcInputs: result.breakdown as never,
          notes: result.confidenceNotes.join(' · ') || null,
        },
      });
      valuationCount++;
    }
  }
  console.log(`   ✓ ${valuationCount} valorisations historisées`);

  // ─────────────────────────────────────────────────────────────
  // MAINTENANCE
  // ─────────────────────────────────────────────────────────────
  const maintSpecs = [
    { msn: '45812', type: 'C_CHECK', months: 7, cost: 1850000, mro: 'Lufthansa Technik' },
    { msn: '38291', type: 'ENGINE_SHOP_VISIT', months: 3, cost: 2400000, mro: 'SR Technics' },
    { msn: '50877', type: 'C_CHECK', months: 0, cost: 1620000, mro: 'AFI KLM E&M', status: 'IN_PROGRESS' },
    { msn: '53412', type: 'C_CHECK', months: 11, cost: 1440000, mro: 'Iberia Maintenance' },
    { msn: '49310', type: 'ENGINE_SHOP_VISIT', months: 2, cost: 2650000, mro: 'À déterminer' },
    { msn: '39442', type: 'D_CHECK', months: 4, cost: 3900000, mro: 'À déterminer' },
    { msn: '51204', type: 'A_CHECK', months: 5, cost: 68000, mro: 'TAP M&E' },
    { msn: '41055', type: 'A_CHECK', months: 2, cost: 72000, mro: 'Iberia Maintenance' },
  ];

  for (const ms of maintSpecs) {
    const ac = createdAircraft.find((a) => a.spec.msn === ms.msn)!;
    await prisma.maintenanceTask.create({
      data: {
        tenantId, aircraftId: ac.id,
        type: ms.type as any,
        description: `${ms.type.replace(/_/g, ' ')} planifié — MSN ${ms.msn}`,
        dueDate: monthsAhead(ms.months),
        estimatedCost: dec(ms.cost), currency: 'USD',
        mroName: ms.mro,
        status: (ms.status ?? 'SCHEDULED') as any,
        downtimeDays: ms.type === 'D_CHECK' ? 45 : ms.type === 'C_CHECK' ? 18 : 3,
      },
    });
  }
  console.log(`   ✓ ${maintSpecs.length} tâches de maintenance`);

  // ─────────────────────────────────────────────────────────────
  // HISTORIQUE (timeline)
  // ─────────────────────────────────────────────────────────────
  let eventCount = 0;
  for (const { id, spec } of createdAircraft) {
    const events = [
      { type: 'DELIVERY', date: d(`${spec.year}-06-15`),
        title: 'Livraison constructeur',
        desc: `Livré neuf par ${spec.mfr}. Configuration ${spec.cabin}.` },
    ];

    if (spec.year < 2018) {
      events.push({
        type: 'MAINTENANCE', date: d(`${spec.year + 3}-04-10`),
        title: 'Premier C-Check',
        desc: 'Visite de maintenance lourde — aucune anomalie majeure.',
      });
    }

    if (spec.year < 2019) {
      events.push({
        type: 'STORAGE', date: d('2020-04-01'),
        title: 'Stockage COVID-19',
        desc: 'Immobilisation 14 mois. Programme de préservation appliqué.',
      });
    }

    if (spec.lastShopVisit) {
      events.push({
        type: 'MAINTENANCE', date: spec.lastShopVisit,
        title: 'Engine Shop Visit',
        desc: `Restauration performance moteur. EGT margin restaurée.`,
      });
    }

    if (spec.operator) {
      events.push({
        type: 'OPERATOR_CHANGE', date: d(`${Math.max(spec.year + 2, 2019)}-01-15`),
        title: `Mise en ligne — ${spec.operator.name}`,
        desc: `Début d'exploitation par ${spec.operator.name}.`,
      });
    }

    for (const e of events) {
      await prisma.assetEvent.create({
        data: {
          tenantId, aircraftId: id, eventType: e.type, eventDate: e.date,
          title: e.title, description: e.desc,
          operatorId: e.type === 'OPERATOR_CHANGE' ? spec.operator?.id : null,
          createdById: admin.id,
        },
      });
      eventCount++;
    }
  }
  console.log(`   ✓ ${eventCount} événements d'historique`);

  // ─────────────────────────────────────────────────────────────
  // DOCUMENTS
  // ─────────────────────────────────────────────────────────────
  let docCount = 0;
  for (const { id, spec } of createdAircraft) {
    const docs = [
      { title: `Certificate of Airworthiness — MSN ${spec.msn}`,
        cat: 'CERTIFICATE', sub: 'CofA', exp: spec.cofa, size: 324000 },
      { title: `Certificate of Registration — ${spec.reg ?? spec.msn}`,
        cat: 'CERTIFICATE', sub: 'CofR', exp: spec.cofa ? daysAhead(600) : null, size: 218000 },
      { title: `Aircraft Technical Log Book — MSN ${spec.msn}`,
        cat: 'MAINTENANCE', sub: 'Log Book', exp: null, size: 8400000 },
      { title: `Insurance Certificate — MSN ${spec.msn}`,
        cat: 'CONTRACT', sub: 'Assurance', exp: spec.insurance, size: 156000 },
    ];

    if (spec.lastShopVisit) {
      docs.push({
        title: `Engine Shop Visit Report — ${spec.engineSerials[0]}`,
        cat: 'MAINTENANCE', sub: 'Engine Shop Visit', exp: null, size: 2400000,
      });
    }

    for (const doc of docs) {
      await prisma.document.create({
        data: {
          tenantId, title: doc.title,
          filename: doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf',
          category: doc.cat as any, subcategory: doc.sub,
          aircraftId: id,
          storageKey: `${tenantId}/${id}/${randomUUID()}/v1`,
          mimeType: 'application/pdf', sizeBytes: doc.size,
          version: 1, issueDate: monthsAgo(Math.floor(Math.random() * 24)),
          expiryDate: doc.exp ?? null,
        },
      });
      docCount++;
    }
  }
  console.log(`   ✓ ${docCount} documents`);

  // ─────────────────────────────────────────────────────────────
  // AUDIT LOG initial
  // ─────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      tenantId, userId: admin.id, userEmail: admin.email,
      action: 'CREATE', resourceType: 'Tenant', resourceId: tenantId,
      result: 'SUCCESS',
      metadata: { note: 'Seed initial — données de démonstration' } as never,
    },
  });

  // ─────────────────────────────────────────────────────────────
  console.log('\n✅ Base de démonstration prête.\n');
  console.log('   Connexion : admin@meridian-aviation.com');
  console.log('   Mot de passe : demo1234\n');
  console.log(`   Portefeuille : ${fleet.length} appareils, ${contractCount} contrats actifs`);
  console.log('   Lancez `npm run alerts:run` pour générer les alertes.\n');
}

main()
  .catch((e) => {
    console.error('❌ Erreur de seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
