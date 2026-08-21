/**
 * AeroOS — Exécution du moteur d'alertes
 * ═══════════════════════════════════════════════════════════════════
 *
 * Usage :
 *   npm run alerts:run              → tous les tenants actifs
 *   npm run alerts:run -- <slug>    → un tenant précis
 *
 * En production : à brancher sur un cron quotidien (03:00 UTC).
 * Le moteur est idempotent — relancer ne crée pas de doublons.
 */

import { prisma } from '../src/lib/db';
import { evaluateAlerts } from '../src/lib/alerts';

async function main() {
  const target = process.argv[2];

  const tenants = await prisma.tenant.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(target ? { name: { contains: target, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, name: true },
  });

  if (tenants.length === 0) {
    console.error(
      target
        ? `Aucun tenant actif correspondant à « ${target} »`
        : 'Aucun tenant actif.'
    );
    process.exit(1);
  }

  console.log(`\n▶ Moteur d'alertes — ${tenants.length} tenant(s)\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalResolved = 0;
  let failures = 0;

  for (const tenant of tenants) {
    const started = Date.now();
    try {
      const result = await evaluateAlerts(tenant.id);
      const ms = Date.now() - started;

      totalCreated += result.created;
      totalUpdated += result.updated;
      totalResolved += result.resolved;

      console.log(
        `  ✓ ${tenant.name.padEnd(32)} ` +
          `+${result.created} créées  ` +
          `~${result.updated} màj  ` +
          `−${result.resolved} résolues  ` +
          `(${ms} ms)`
      );
    } catch (err) {
      failures++;
      console.error(`  ✗ ${tenant.name} — échec :`, err);
    }
  }

  console.log(
    `\n▶ Terminé — ${totalCreated} créées, ${totalUpdated} mises à jour, ` +
      `${totalResolved} résolues${failures > 0 ? `, ${failures} échec(s)` : ''}\n`
  );

  await prisma.$disconnect();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Erreur fatale :', err);
  await prisma.$disconnect();
  process.exit(1);
});
