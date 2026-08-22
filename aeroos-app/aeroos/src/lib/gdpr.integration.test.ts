/**
 * Régression automatisée de la vérification manuelle faite pendant T4.2
 * (cf. TODO.md). Tenant jetable, jamais le tenant de démo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exportUserData, eraseUserData, isAnonymizedEmail } from './gdpr';
import { withTenant } from './db';
import { createTestTenant, destroyTestTenant } from './__tests__/testTenant';

describe('exportUserData / eraseUserData — intégration', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await createTestTenant('gdpr');
  });

  afterAll(async () => {
    await destroyTestTenant(tenantId);
  });

  async function createUser(email: string) {
    return withTenant(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId, email, passwordHash: 'x', firstName: 'QA', lastName: 'Test',
          role: 'VIEWER',
        },
      })
    );
  }

  it('exportUserData retourne le profil sans secrets, et null pour un utilisateur inconnu', async () => {
    const user = await createUser('qa-export@example.invalid');

    const data = await exportUserData(tenantId, user.id);
    expect(data).not.toBeNull();
    expect(data!.user.email).toBe('qa-export@example.invalid');
    expect(data).not.toHaveProperty('user.passwordHash');
    expect(JSON.stringify(data)).not.toContain('passwordHash');

    const missing = await exportUserData(tenantId, '00000000-0000-0000-0000-000000000000');
    expect(missing).toBeNull();
  });

  it('exportUserData inclut les actions liées (AssetEvent créé par l\'utilisateur)', async () => {
    const user = await createUser('qa-export-actions@example.invalid');
    const aircraft = await withTenant(tenantId, (tx) =>
      tx.aircraft.create({
        data: { tenantId, msn: 'QA-GDPR-001', manufacturer: 'Airbus', model: 'A320', yearBuilt: 2018 },
      })
    );
    await withTenant(tenantId, (tx) =>
      tx.assetEvent.create({
        data: {
          tenantId, aircraftId: aircraft.id, eventType: 'MAINTENANCE',
          eventDate: new Date(), title: 'QA event', createdById: user.id,
        },
      })
    );

    const data = await exportUserData(tenantId, user.id);
    expect(data!.actions.assetEventsCreated).toHaveLength(1);
    expect(data!.actions.assetEventsCreated[0].title).toBe('QA event');
  });

  it('eraseUserData anonymise, préserve l\'intégrité référentielle, et est idempotent (already_erased)', async () => {
    const user = await createUser('qa-erase@example.invalid');
    const aircraft = await withTenant(tenantId, (tx) =>
      tx.aircraft.create({
        data: { tenantId, msn: 'QA-GDPR-002', manufacturer: 'Airbus', model: 'A320', yearBuilt: 2018 },
      })
    );
    const event = await withTenant(tenantId, (tx) =>
      tx.assetEvent.create({
        data: {
          tenantId, aircraftId: aircraft.id, eventType: 'MAINTENANCE',
          eventDate: new Date(), title: 'QA event 2', createdById: user.id,
        },
      })
    );

    const result = await eraseUserData(tenantId, user.id, { reason: 'test QA' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(isAnonymizedEmail(result.anonymizedEmail)).toBe(true);

    const anonymized = await withTenant(tenantId, (tx) =>
      tx.user.findFirst({ where: { id: user.id } })
    );
    expect(anonymized?.firstName).toBe('[supprimé]');
    expect(anonymized?.lastName).toBe('[supprimé]');
    expect(anonymized?.deletedAt).not.toBeNull();
    expect(isAnonymizedEmail(anonymized!.email)).toBe(true);

    // Intégrité référentielle : l'AssetEvent pointe toujours vers le même id
    const eventAfter = await withTenant(tenantId, (tx) =>
      tx.assetEvent.findFirst({ where: { id: event.id } })
    );
    expect(eventAfter?.createdById).toBe(user.id);

    // Idempotence
    const second = await eraseUserData(tenantId, user.id, { reason: 'retry' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already_erased');
  });

  it("eraseUserData anonymise un compte déjà deletedAt (désactivé) sans écraser sa date d'origine", async () => {
    const user = await createUser('qa-erase-stale@example.invalid');
    const originalDeletedAt = new Date('2026-01-01T00:00:00Z');
    await withTenant(tenantId, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { deletedAt: originalDeletedAt } })
    );

    const result = await eraseUserData(tenantId, user.id, { reason: 'retention purge simulée' });
    expect(result.ok).toBe(true);

    const anonymized = await withTenant(tenantId, (tx) =>
      tx.user.findFirst({ where: { id: user.id } })
    );
    expect(anonymized?.deletedAt?.toISOString()).toBe(originalDeletedAt.toISOString());
  });

  it('eraseUserData sur un utilisateur inconnu renvoie not_found', async () => {
    const result = await eraseUserData(tenantId, '00000000-0000-0000-0000-000000000000', {
      reason: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});
