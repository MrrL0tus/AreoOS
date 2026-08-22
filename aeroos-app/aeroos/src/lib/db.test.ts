import { describe, it, expect } from 'vitest';
import { isUuid, serializeDecimals, TenantContextError } from './db';

describe('isUuid', () => {
  it('accepte un UUID v4 valide', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('rejette une chaîne vide, un id lisible, ou un UUID malformé', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('550e8400-e29b-41d4-a716')).toBe(false);
  });
});

describe('serializeDecimals', () => {
  it('convertit un objet imitant un Decimal Prisma (toNumber) en nombre', () => {
    const fakeDecimal = { toNumber: () => 1234.5 };
    const result = serializeDecimals({ amount: fakeDecimal, label: 'x' });
    expect(result).toEqual({ amount: 1234.5, label: 'x' });
  });

  it('laisse intactes les valeurs qui ne sont pas des Decimal', () => {
    const result = serializeDecimals({ a: 1, b: 'text', c: null, d: [1, 2, 3] });
    expect(result).toEqual({ a: 1, b: 'text', c: null, d: [1, 2, 3] });
  });

  it('fonctionne récursivement dans des structures imbriquées', () => {
    const fakeDecimal = { toNumber: () => 42 };
    const result = serializeDecimals({ nested: { value: fakeDecimal } });
    expect(result).toEqual({ nested: { value: 42 } });
  });
});

describe('TenantContextError', () => {
  it('porte le bon nom et message', () => {
    const err = new TenantContextError('contexte manquant');
    expect(err.name).toBe('TenantContextError');
    expect(err.message).toBe('contexte manquant');
    expect(err).toBeInstanceOf(Error);
  });
});
