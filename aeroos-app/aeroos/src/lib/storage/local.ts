/**
 * Stockage local (dev sans compte cloud). ⚠️ Pas de chiffrement au repos
 * — c'est la limite documentée de ce driver (cf. TODO T2.5). En
 * production, utiliser STORAGE_DRIVER=s3 (chiffrement SSE-S3, cf.
 * ./s3.ts).
 */
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { StorageDriver } from '../storage';

const ROOT = process.env.LOCAL_STORAGE_PATH
  ? path.resolve(process.env.LOCAL_STORAGE_PATH)
  : path.join(process.cwd(), 'storage-local');

/** Empêche toute évasion du dossier de stockage via des segments `..`. */
function resolveSafePath(key: string): string {
  const segments = key.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segments.length === 0) throw new Error('Clé de stockage invalide');
  return path.join(ROOT, ...segments);
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET manquant');
  return secret;
}

export const localStorageDriver: StorageDriver = {
  async put(key, data, contentType) {
    const filePath = resolveSafePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }));
  },

  async get(key) {
    return fs.readFile(resolveSafePath(key));
  },

  async delete(key) {
    const filePath = resolveSafePath(key);
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.meta.json`, { force: true });
  },

  async sign(key, expirySeconds) {
    const expires = Date.now() + expirySeconds * 1000;
    const sig = crypto
      .createHmac('sha256', getSecret())
      .update(`${key}:${expires}`)
      .digest('hex');
    const params = new URLSearchParams({ key, expires: String(expires), sig });
    return `/api/documents/download?${params.toString()}`;
  },
};

export function verifyLocalSignature(key: string, expires: number, sig: string): boolean {
  if (Date.now() > expires) return false;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(`${key}:${expires}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
