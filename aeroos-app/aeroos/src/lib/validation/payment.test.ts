import { describe, it, expect } from 'vitest';
import { paymentSchema } from './payment';

describe('paymentSchema', () => {
  it('accepte un paiement valide', () => {
    const result = paymentSchema.safeParse({
      amountReceived: '285000',
      receivedDate: '2026-08-01',
      notes: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejette un montant négatif ou nul', () => {
    expect(paymentSchema.safeParse({ amountReceived: '-1', receivedDate: '2026-08-01' }).success).toBe(false);
    expect(paymentSchema.safeParse({ amountReceived: '0', receivedDate: '2026-08-01' }).success).toBe(false);
  });

  it('exige une date de réception', () => {
    const result = paymentSchema.safeParse({ amountReceived: '1000' });
    expect(result.success).toBe(false);
  });

  it('rejette des notes trop longues (> 1000 caractères)', () => {
    const result = paymentSchema.safeParse({
      amountReceived: '1000',
      receivedDate: '2026-08-01',
      notes: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});
