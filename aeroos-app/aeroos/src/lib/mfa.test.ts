import { describe, it, expect } from 'vitest';
import { authenticator } from 'otplib';
import {
  generateSecret, buildOtpauthUrl, buildQrCodeDataUrl, verifyToken,
  generateRecoveryCodes, matchRecoveryCode,
} from './mfa';

describe('generateSecret / buildOtpauthUrl', () => {
  it('génère un secret non vide, différent à chaque appel', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('construit une URL otpauth:// exploitable par une app TOTP', () => {
    const secret = generateSecret();
    const url = buildOtpauthUrl(secret, 'admin@meridian-aviation.com');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('AeroOS');
  });
});

describe('buildQrCodeDataUrl', () => {
  it('encode l\'URL otpauth en data URL PNG', async () => {
    const secret = generateSecret();
    const url = buildOtpauthUrl(secret, 'admin@meridian-aviation.com');
    const dataUrl = await buildQrCodeDataUrl(url);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('verifyToken', () => {
  it('accepte un code TOTP valide pour le secret courant', () => {
    const secret = generateSecret();
    const token = authenticator.generate(secret);
    expect(verifyToken(secret, token)).toBe(true);
  });

  it('rejette un code invalide', () => {
    const secret = generateSecret();
    expect(verifyToken(secret, '000000')).toBe(false);
  });

  it('ne lève jamais d\'exception sur une entrée malformée', () => {
    expect(() => verifyToken('', 'abc')).not.toThrow();
    expect(verifyToken('', 'abc')).toBe(false);
  });
});

describe('generateRecoveryCodes / matchRecoveryCode', () => {
  it('génère 8 codes uniques au format XXXXX-XXXXX', async () => {
    const { plain, hashed } = await generateRecoveryCodes();
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
    for (const code of plain) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(new Set(plain).size).toBe(8);
  });

  it('retrouve l\'index du code de récupération correspondant', async () => {
    const { plain, hashed } = await generateRecoveryCodes();
    const index = await matchRecoveryCode(plain[3], hashed);
    expect(index).toBe(3);
  });

  it('tolère la casse et les espaces à la saisie', async () => {
    const { plain, hashed } = await generateRecoveryCodes();
    const index = await matchRecoveryCode(`  ${plain[0].toLowerCase()}  `, hashed);
    expect(index).toBe(0);
  });

  it('retourne null pour un code qui ne correspond à aucun hachage', async () => {
    const { hashed } = await generateRecoveryCodes();
    const index = await matchRecoveryCode('AAAAA-AAAAA', hashed);
    expect(index).toBeNull();
  });
});
