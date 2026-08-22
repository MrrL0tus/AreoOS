/**
 * AeroOS — Recalcul des valorisations
 * ═══════════════════════════════════════════════════════════════════
 *
 * Usage :
 *   npm run valuation:refresh           → tous les tenants
 *   npm run valuation:refresh -- <slug> → un tenant précis
 *
 * En production : cron mensuel (1er du mois, 04:00 UTC).
 *
 * ⚠️  Les valeurs produites sont ALGORITHMIQUES et non certifiées
 * (cf. Cahier de conformité §4.3). Une valorisation certifiée saisie
 * manuellement n'est jamais écrasée par ce script.
 */

import { prisma, withTenant, asSystem } from '../src/lib/db';
import { calculateValuation } from '../src/lib/valuation';

async function main() {
  const target = process.argv[2];
  const valuationDate = new Date();

  // Découverte cross-tenant : contourne volontairement le RLS (cf.
  // run-alerts.ts pour la même remarque).
  const tenants = await asSystem(
    'refresh-valuations: découverte des tenants actifs pour recalcul planifié',
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
    console.error('Aucun tenant correspondant.');
    process.exit(1);
  }

  console.log(`\n▶ Recalcul des valorisations — ${tenants.length} tenant(s)\n`);

  let totalValued = 0;
  let totalSkipped = 0;

  for (const tenant of tenants) {
    await withTenant(tenant.id, async (tx) => {
      const fleet = await tx.aircraft.findMany({
        where: { deletedAt: null, status: { notIn: ['SOLD', 'PARTED_OUT'] } },
        include: {
          engines: {
            where: { deletedAt: null },
            select: {
              llpCyclesRemaining: true,
              egtMargin: true,
              lastShopVisitDate: true,
            },
          },
          maintenance: {
            where: {
              deletedAt: null,
              type: { in: ['C_CHECK', 'D_CHECK'] },
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
            orderBy: { dueDate: 'asc' },
            take: 1,
            select: { dueDate: true },
          },
        },
      });

      console.log(`  ${tenant.name} — ${fleet.length} actif(s)`);

      for (const ac of fleet) {
        // Ne jamais écraser une valorisation certifiée du même mois
        const existingCertified = await tx.valuationRecord.findFirst({
          where: {
            aircraftId: ac.id,
            isCertified: true,
            valuationDate: {
              gte: new Date(
                valuationDate.getFullYear(),
                valuationDate.getMonth(),
                1
              ),
            },
          },
        });

        if (existingCertified) {
          totalSkipped++;
          console.log(
            `    − ${ac.msn.padEnd(8)} ignoré (valorisation certifiée présente)`
          );
          continue;
        }

        try {
          const result = calculateValuation({
            manufacturer: ac.manufacturer,
            model: ac.model,
            variant: ac.variant,
            yearBuilt: ac.yearBuilt,
            totalHours: ac.totalHours,
            totalCycles: ac.totalCycles,
            hoursQuality: ac.hoursQuality,
            engines: ac.engines,
            openAdCount: ac.openAdCount,
            nextHeavyCheckDate: ac.maintenance[0]?.dueDate ?? null,
            valuationDate,
          });

          await tx.valuationRecord.create({
            data: {
              tenantId: tenant.id,
              aircraftId: ac.id,
              valuationDate,
              currency: result.currency,
              baseValue: result.baseValue,
              currentMarketValue: result.currentMarketValue,
              residualValue: result.residualValue,
              residualValueDate: result.residualValueDate,
              method: 'ALGORITHMIC',
              source: 'AeroOS Engine v1',
              isCertified: false,
              calcInputs: result.breakdown as never,
              notes: result.confidenceNotes.join(' · '),
            },
          });

          totalValued++;
          console.log(
            `    ✓ ${ac.msn.padEnd(8)} ` +
              `BV ${(result.baseValue / 1e6).toFixed(1)} M$  ` +
              `CMV ${(result.currentMarketValue / 1e6).toFixed(1)} M$  ` +
              `[${result.confidence}]`
          );
        } catch (err) {
          console.error(`    ✗ ${ac.msn} — échec :`, (err as Error).message);
        }
      }
    });
  }

  console.log(
    `\n▶ Terminé — ${totalValued} valorisation(s) créée(s), ` +
      `${totalSkipped} ignorée(s)\n`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Erreur fatale :', err);
  await prisma.$disconnect();
  process.exit(1);
});
