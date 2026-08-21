/**
 * AeroOS — MFA par TOTP (RFC 6238)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Fonctions pures : aucun accès base ici. La persistance (mfaSecret,
 * mfaEnabled, mfaRecoveryCodes) est gérée par les routes API et
 * src/lib/auth.ts, qui passent toujours par withTenant() / asSystem().
 *
 * ⚠️ Le secret et les codes de récupération ne doivent jamais être
 * journalisés (console.log/warn/error) ni inclus dans un audit().
 */

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const ISSUER = 'AeroOS';
const RECOVERY_CODE_COUNT = 8;

// Fenêtre de tolérance ±1 période (30s) pour absorber le décalage d'horloge
authenticator.options = { window: 1 };

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(secret: string, email: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export async function buildQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyToken(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/**
 * Génère des codes de récupération lisibles (ex. "A1B2-C3D4"), à usage
 * unique. Retourne les codes en clair (à afficher une seule fois) et
 * leurs hachages (à persister).
 */
export async function generateRecoveryCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const plain: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  const hashed = await Promise.all(plain.map((code) => bcrypt.hash(code, 10)));
  return { plain, hashed };
}

/**
 * Compare un code de récupération saisi aux hachages stockés.
 * Retourne l'index du hachage correspondant (à retirer du tableau),
 * ou null si aucune correspondance.
 */
export async function matchRecoveryCode(
  code: string,
  hashedCodes: string[]
): Promise<number | null> {
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(normalized, hashedCodes[i])) {
      return i;
    }
  }
  return null;
}
