import { describe, it, expect } from 'vitest';
import { buildMonthlyPayments } from './contract-activation';

describe('buildMonthlyPayments', () => {
  it('une échéance par mois calendaire couvert, due le 1er', () => {
    const payments = buildMonthlyPayments({
      startDate: new Date(2026, 0, 15), // 15 janvier
      endDate: new Date(2026, 2, 10), // 10 mars
      monthlyRent: 1000,
      currency: 'USD',
    });
    expect(payments).toHaveLength(3); // janvier, février, mars
    expect(payments.map((p) => p.periodLabel)).toEqual(['2026-01', '2026-02', '2026-03']);
    for (const p of payments) {
      expect(p.dueDate.getDate()).toBe(1);
      expect(p.amountDue).toBe(1000);
      expect(p.currency).toBe('USD');
    }
  });

  it('même mois de début et de fin → une seule échéance', () => {
    const payments = buildMonthlyPayments({
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 5, 28),
      monthlyRent: 500,
      currency: 'EUR',
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].periodLabel).toBe('2026-06');
  });

  it('traverse un changement d\'année sans erreur', () => {
    const payments = buildMonthlyPayments({
      startDate: new Date(2025, 10, 1), // novembre 2025
      endDate: new Date(2026, 1, 1), // février 2026
      monthlyRent: 100,
      currency: 'USD',
    });
    expect(payments.map((p) => p.periodLabel)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02',
    ]);
  });

  it('chaque dueDate est une instance Date distincte (pas d\'aliasing du curseur)', () => {
    const payments = buildMonthlyPayments({
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 3, 1),
      monthlyRent: 1,
      currency: 'USD',
    });
    const times = payments.map((p) => p.dueDate.getTime());
    expect(new Set(times).size).toBe(times.length);
  });
});
