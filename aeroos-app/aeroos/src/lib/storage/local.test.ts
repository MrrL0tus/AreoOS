import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// LOCAL_STORAGE_PATH doit être fixé avant l'import du module (racine lue
// une seule fois au chargement) — d'où le dossier temporaire dédié pour
// ne jamais écrire dans storage-local/ du projet pendant les tests.
const tmpRoot = path.join(os.tmpdir(), `aeroos-qa-storage-${Date.now()}`);
process.env.LOCAL_STORAGE_PATH = tmpRoot;
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';

const { localStorageDriver, verifyLocalSignature } = await import('./local');

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('localStorageDriver — put/get/delete', () => {
  it('écrit puis relit le même contenu binaire', async () => {
    const key = 'tenant-a/aircraft-1/doc-1/v1';
    const data = Buffer.from('contenu de test');
    await localStorageDriver.put(key, data, 'application/pdf');
    const read = await localStorageDriver.get(key);
    expect(read.equals(data)).toBe(true);
  });

  it('delete rend le fichier inaccessible sans lever d\'exception si absent', async () => {
    const key = 'tenant-a/aircraft-1/doc-2/v1';
    await localStorageDriver.put(key, Buffer.from('x'), 'application/pdf');
    await localStorageDriver.delete(key);
    await expect(localStorageDriver.get(key)).rejects.toThrow();
    await expect(localStorageDriver.delete(key)).resolves.not.toThrow();
  });

  it('neutralise les segments ".." plutôt que de les suivre (pas d\'évasion du dossier de stockage)', async () => {
    // resolveSafePath() filtre les segments ".", ".." plutôt que de
    // lever une exception dédiée : "../../../etc/passwd" retombe sur
    // "<ROOT>/etc/passwd", jamais sur le vrai /etc/passwd — d'où un
    // ENOENT (fichier absent du sandbox), pas une erreur "invalide" et
    // surtout jamais une lecture hors de ROOT.
    await expect(localStorageDriver.get('../../../etc/passwd')).rejects.toThrow(/ENOENT/);
  });

  it('une clé réduite à des segments "." / ".." lève une erreur explicite', async () => {
    await expect(localStorageDriver.get('../..')).rejects.toThrow(/invalide/i);
  });
});

describe('sign / verifyLocalSignature', () => {
  it('un lien signé fraîchement émis est valide', async () => {
    const key = 'tenant-a/aircraft-1/doc-3/v1';
    const url = await localStorageDriver.sign(key, 300);
    const params = new URL(url, 'http://localhost').searchParams;
    const expires = Number(params.get('expires'));
    const sig = params.get('sig')!;
    expect(verifyLocalSignature(key, expires, sig)).toBe(true);
  });

  it('un lien expiré est rejeté', () => {
    const key = 'tenant-a/aircraft-1/doc-4/v1';
    const expiredAt = Date.now() - 1000;
    // Signature recalculée avec le même secret pour isoler le test sur
    // l'expiration seule, pas sur une signature invalide.
    const sig = crypto
      .createHmac('sha256', process.env.AUTH_SECRET!)
      .update(`${key}:${expiredAt}`)
      .digest('hex');
    expect(verifyLocalSignature(key, expiredAt, sig)).toBe(false);
  });

  it('une signature falsifiée est rejetée', async () => {
    const key = 'tenant-a/aircraft-1/doc-5/v1';
    const url = await localStorageDriver.sign(key, 300);
    const params = new URL(url, 'http://localhost').searchParams;
    const expires = Number(params.get('expires'));
    expect(verifyLocalSignature(key, expires, 'deadbeef'.repeat(8))).toBe(false);
  });

  it('une clé différente de celle signée est rejetée (pas de rejeu croisé)', async () => {
    const key = 'tenant-a/aircraft-1/doc-6/v1';
    const url = await localStorageDriver.sign(key, 300);
    const params = new URL(url, 'http://localhost').searchParams;
    const expires = Number(params.get('expires'));
    const sig = params.get('sig')!;
    expect(verifyLocalSignature('tenant-b/aircraft-9/doc-9/v1', expires, sig)).toBe(false);
  });
});
