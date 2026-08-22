/**
 * Fixtures partagées pour les tests d'intégration (T5.1) : un tenant
 * jetable réel, créé et détruit dans Postgres via le rôle admin (même
 * approche que scripts/test-tenant-isolation.ts). N'écrit jamais dans le
 * tenant de démo Meridian.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const adminPrisma = new PrismaClient({
  datasources: { db: { url: process.env.ADMIN_DATABASE_URL } },
});

export async function createTestTenant(label: string): Promise<string> {
  const tenantId = randomUUID();
  await adminPrisma.tenant.create({
    data: { id: tenantId, name: `QA-VITEST ${label} ${tenantId.slice(0, 8)}`, plan: 'PROFESSIONAL' },
  });
  return tenantId;
}

/**
 * Supprime toutes les données d'un tenant jetable, tables enfants
 * d'abord (pas de cascade FK défini). `audit_logs` est délibérément
 * tenté puis ignoré s'il échoue : le trigger `reject_audit_mutation`
 * (cf. prisma/rls.sql) le rend append-only même pour ce rôle admin —
 * les entrées d'audit d'un tenant de test survivent donc à son
 * nettoyage, comme en production.
 */
export async function destroyTestTenant(tenantId: string): Promise<void> {
  const childTables = [
    'ai_extractions', 'maintenance_tasks', 'alerts', 'valuation_records',
    'documents', 'payments', 'lease_contracts', 'asset_events',
    'components', 'engines', 'aircraft', 'operators', 'users',
  ];
  await adminPrisma.$executeRawUnsafe(
    `DELETE FROM audit_logs WHERE "tenantId" = $1`,
    tenantId
  ).catch(() => {});
  for (const table of childTables) {
    await adminPrisma.$executeRawUnsafe(
      `DELETE FROM ${table} WHERE "tenantId" = $1`,
      tenantId
    );
  }
  await adminPrisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenantId);
}

export async function disconnectTestTenantHelper(): Promise<void> {
  await adminPrisma.$disconnect();
}
