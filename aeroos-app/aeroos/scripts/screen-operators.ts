/**
 * AeroOS — Revue sanctions périodique des opérateurs (T4.1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Rescreenne tous les opérateurs actifs de tous les tenants contre la
 * liste de référence sanctioned_entities. Satisfait l'exigence "revue
 * annuelle" du cahier de conformité §5.4 — à brancher sur un cron
 * annuel en production ; peut aussi être relancé manuellement après
 * import d'une liste mise à jour.
 *
 * Usage :
 *   npm run sanctions:screen              → tous les tenants actifs
 *   npm run sanctions:screen -- <slug>    → un tenant précis
 */

import { prisma, asSystem } from '../src/lib/db';
import { screenOperator } from '../src/lib/compliance/sanctions';

async function main() {
  const target = process.argv[2];

  const tenants = await asSystem(
    'screen-operators: découverte des tenants actifs pour revue sanctions planifiée',
    (client) =>
      client.tenant.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          ...(target ? { name: { contains: target, mode: 'insensitive' as const } } : {}),
        },
        select: { id: true, name: true },
      })
  );

  if (tenants.length === 0) {
    console.error(
      target ? `Aucun tenant actif correspondant à « ${target} »` : 'Aucun tenant actif.'
    );
    process.exit(1);
  }

  console.log(`\n▶ Revue sanctions — ${tenants.length} tenant(s)\n`);

  let totalScreened = 0;
  let totalNewFlags = 0;
  let failures = 0;

  for (const tenant of tenants) {
    // Liste des opérateurs traverse withTenant() normalement à
    // l'intérieur de screenOperator() — ici on a seulement besoin des
    // IDs, via une requête tenant-scopée dédiée.
    const operators = await asSystem(
      `screen-operators: liste des opérateurs actifs du tenant ${tenant.id}`,
      (client) =>
        client.operator.findMany({
          where: { tenantId: tenant.id, deletedAt: null, isActive: true },
          select: { id: true, name: true, sanctionsStatus: true },
        })
    );

    console.log(`  ${tenant.name} — ${operators.length} opérateur(s)`);

    for (const op of operators) {
      try {
        const result = await screenOperator(tenant.id, op.id, {
          reason: 'revue annuelle programmée (screen-operators)',
        });
        totalScreened++;
        if (result.status !== result.previousStatus) {
          totalNewFlags++;
          console.log(
            `    ⚠ ${result.operatorName} : ${result.previousStatus} → ${result.status}` +
              (result.bestMatch ? ` (≈ ${result.bestMatch.entityName}, ${(result.bestMatch.similarity * 100).toFixed(0)}%)` : '')
          );
        } else {
          console.log(`    ✓ ${result.operatorName} : ${result.status}`);
        }
      } catch (err) {
        failures++;
        console.error(`    ✗ ${op.name} — échec :`, err);
      }
    }
  }

  console.log(
    `\n▶ Terminé — ${totalScreened} opérateur(s) screené(s), ${totalNewFlags} changement(s) de statut` +
      `${failures > 0 ? `, ${failures} échec(s)` : ''}\n`
  );

  await prisma.$disconnect();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Erreur fatale :', err);
  await prisma.$disconnect();
  process.exit(1);
});
