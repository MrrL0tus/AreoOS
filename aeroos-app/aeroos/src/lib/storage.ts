/**
 * AeroOS — Abstraction de stockage documentaire
 * ═══════════════════════════════════════════════════════════════════
 *
 * Deux implémentations, sélectionnées par STORAGE_DRIVER (local | s3) :
 * permet de développer sans compte cloud (cf. TODO T2.5).
 *
 * Clé de stockage : {tenantId}/{aircraftId}/{documentId}/v{version} —
 * le tenantId en premier segment permet une vérification d'appartenance
 * tenant par simple préfixe, sans aller-retour base, avant même de
 * consulter le driver (cf. route de téléchargement signée).
 */

import { localStorageDriver } from './storage/local';
import { s3StorageDriver } from './storage/s3';

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** URL de téléchargement signée, valable `expirySeconds` secondes. */
  sign(key: string, expirySeconds: number): Promise<string>;
}

export function getStorage(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 's3') return s3StorageDriver;
  return localStorageDriver;
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 Mo

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function buildStorageKey(
  tenantId: string,
  aircraftId: string,
  documentId: string,
  version: number
): string {
  return `${tenantId}/${aircraftId}/${documentId}/v${version}`;
}
