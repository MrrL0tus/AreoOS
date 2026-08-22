/**
 * Intègre `npm run test:isolation` (scripts/test-tenant-isolation.ts) au
 * run `npm test` (T5.1 : "Isolation tenant — déjà couverte par
 * test:isolation, à intégrer"). Ce script est le test de sécurité le
 * plus important du projet — on le RÉUTILISE en le lançant comme
 * sous-processus plutôt que de dupliquer sa logique en assertions
 * vitest, pour ne jamais faire diverger les deux versions d'un test
 * aussi critique.
 */
import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

describe("intégration de scripts/test-tenant-isolation.ts", () => {
  it("l'isolation multi-tenant (RLS) est vérifiée par le script dédié", async () => {
    const projectRoot = path.resolve(__dirname, '../..');

    await expect(
      execAsync('npm run test:isolation', { cwd: projectRoot, timeout: 60_000 })
    ).resolves.toBeTruthy();
  }, 60_000);
});
