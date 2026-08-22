import { describe, it, expect, afterEach } from 'vitest';
import { buildStorageKey, getStorage, MAX_UPLOAD_BYTES, ALLOWED_MIME_TYPES } from './storage';

describe('buildStorageKey', () => {
  it('compose tenantId/aircraftId/documentId/vVersion', () => {
    expect(buildStorageKey('t1', 'a1', 'd1', 2)).toBe('t1/a1/d1/v2');
  });
});

describe('MAX_UPLOAD_BYTES / ALLOWED_MIME_TYPES', () => {
  it('limite à 50 Mo', () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });
  it('couvre pdf/jpg/png/docx/xlsx uniquement', () => {
    expect(Object.keys(ALLOWED_MIME_TYPES).sort()).toEqual(
      [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
      ].sort()
    );
  });
});

describe('getStorage — sélection du driver par variable d\'environnement', () => {
  const original = process.env.STORAGE_DRIVER;
  afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = original;
  });

  it('driver local par défaut', () => {
    delete process.env.STORAGE_DRIVER;
    const driver = getStorage();
    expect(typeof driver.put).toBe('function');
    expect(typeof driver.sign).toBe('function');
  });

  it('driver s3 quand STORAGE_DRIVER=s3', () => {
    process.env.STORAGE_DRIVER = 's3';
    const driver = getStorage();
    expect(typeof driver.put).toBe('function');
  });
});
