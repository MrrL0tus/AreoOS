/**
 * Tests d'intégration (Postgres réel, tenant jetable — cf. testTenant.ts).
 * Couvre la priorité #2 de T5.1 : chaque règle du moteur d'alertes, et
 * son idempotence.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { evaluateAlerts } from './alerts';
import { withTenant } from './db';
import { createTestTenant, destroyTestTenant } from './__tests__/testTenant';
import type { AlertType } from '@prisma/client';

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

describe('evaluateAlerts — intégration', () => {
  let tenantId: string;
  let contractId: string;

  beforeAll(async () => {
    tenantId = await createTestTenant('alerts');
    const now = new Date();

    const operator = await withTenant(tenantId, (tx) =>
      tx.operator.create({
        data: { tenantId, name: 'QA Lessee', country: 'FR', sanctionsStatus: 'FLAGGED' },
      })
    );

    const aircraft = await withTenant(tenantId, (tx) =>
      tx.aircraft.create({
        data: {
          tenantId, msn: 'QA-ALERTS-001', manufacturer: 'Airbus', model: 'A320',
          yearBuilt: 2015, status: 'ON_LEASE',
          insuranceExpiryDate: addDays(now, 15),
          cofaExpiryDate: addDays(now, 20),
          currentOperatorId: operator.id,
        },
      })
    );

    const contract = await withTenant(tenantId, (tx) =>
      tx.leaseContract.create({
        data: {
          tenantId, reference: 'QA-CTR-001', aircraftId: aircraft.id,
          lessorName: 'QA Lessor', lesseeId: operator.id,
          startDate: addDays(now, -365), endDate: addDays(now, 20),
          monthlyRent: 10000, currency: 'USD', status: 'ACTIVE',
        },
      })
    );
    contractId = contract.id;

    await withTenant(tenantId, (tx) =>
      tx.payment.create({
        data: {
          tenantId, contractId: contract.id, periodLabel: '2026-QA',
          dueDate: addDays(now, -10), amountDue: 10000, currency: 'USD',
          status: 'DUE',
        },
      })
    );

    await withTenant(tenantId, (tx) =>
      tx.document.create({
        data: {
          tenantId, title: 'QA Certificat', filename: 'qa.pdf', category: 'CERTIFICATE',
          aircraftId: aircraft.id, storageKey: `${tenantId}/qa/doc/v1`,
          mimeType: 'application/pdf', sizeBytes: 1, expiryDate: addDays(now, 15),
        },
      })
    );

    await withTenant(tenantId, (tx) =>
      tx.maintenanceTask.create({
        data: {
          tenantId, aircraftId: aircraft.id, type: 'C_CHECK',
          dueDate: addDays(now, 60), status: 'PLANNED',
        },
      })
    );

    await withTenant(tenantId, (tx) =>
      tx.engine.create({
        data: {
          tenantId, serialNumber: 'QA-ENG-001', manufacturer: 'CFM', model: 'CFM56',
          aircraftId: aircraft.id, llpCyclesRemaining: 2500,
        },
      })
    );

    await withTenant(tenantId, (tx) =>
      tx.valuationRecord.create({
        data: { tenantId, aircraftId: aircraft.id, valuationDate: now, baseValue: 30_000_000 },
      })
    );
  });

  afterAll(async () => {
    await destroyTestTenant(tenantId);
  });

  it('génère une alerte pour chacune des règles couvertes par les fixtures', async () => {
    const result = await evaluateAlerts(tenantId);
    expect(result.created).toBeGreaterThanOrEqual(9);

    const alerts = await withTenant(tenantId, (tx) =>
      tx.alert.findMany({ where: { resolvedAt: null } })
    );
    const types = new Set(alerts.map((a) => a.type));
    const expectedTypes: AlertType[] = [
      'CONTRACT_EXPIRY', 'PAYMENT_OVERDUE', 'INSURANCE_EXPIRY',
      'CERTIFICATE_EXPIRY', 'DOCUMENT_EXPIRY', 'MAINTENANCE_DUE',
      'CONCENTRATION_BREACH', 'SANCTIONS_FLAG', 'LLP_THRESHOLD',
    ];
    for (const t of expectedTypes) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('est idempotent : un second passage sans changement ne crée ni ne duplique rien', async () => {
    const before = await withTenant(tenantId, (tx) =>
      tx.alert.count({ where: { resolvedAt: null } })
    );
    const result = await evaluateAlerts(tenantId);
    expect(result.created).toBe(0);
    expect(result.resolved).toBe(0);
    const after = await withTenant(tenantId, (tx) =>
      tx.alert.count({ where: { resolvedAt: null } })
    );
    expect(after).toBe(before);
  });

  it("résout une alerte dont la condition n'est plus remplie (paiement reçu), sans toucher aux autres", async () => {
    const openBefore = await withTenant(tenantId, (tx) =>
      tx.alert.count({ where: { resolvedAt: null } })
    );

    await withTenant(tenantId, (tx) =>
      tx.payment.updateMany({
        where: { contractId },
        data: { status: 'RECEIVED', receivedDate: new Date() },
      })
    );

    const result = await evaluateAlerts(tenantId);
    expect(result.resolved).toBe(1);
    expect(result.created).toBe(0);

    const stillOpenPaymentAlerts = await withTenant(tenantId, (tx) =>
      tx.alert.findMany({ where: { type: 'PAYMENT_OVERDUE', resolvedAt: null } })
    );
    expect(stillOpenPaymentAlerts).toHaveLength(0);

    const openAfter = await withTenant(tenantId, (tx) =>
      tx.alert.count({ where: { resolvedAt: null } })
    );
    expect(openAfter).toBe(openBefore - 1);
  });
});
