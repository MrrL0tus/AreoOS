import { describe, it, expect } from 'vitest';
import { isCommonPassword } from './common-passwords';

describe('isCommonPassword', () => {
  it('détecte un mot de passe littéral connu', () => {
    expect(isCommonPassword('123456')).toBe(true);
    expect(isCommonPassword('password123')).toBe(true);
  });

  it('insensible à la casse', () => {
    expect(isCommonPassword('PaSsWoRd123')).toBe(true);
  });

  it('détecte un mot de base combiné à un suffixe usuel', () => {
    expect(isCommonPassword('dragon2024')).toBe(true);
    expect(isCommonPassword('sunshine!')).toBe(true);
  });

  it("ne signale pas un mot de passe suffisamment aléatoire", () => {
    expect(isCommonPassword('Xk9#mQ2$vL7pR4z')).toBe(false);
  });
});
