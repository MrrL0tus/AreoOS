/**
 * AeroOS — Purge selon les durées de rétention (T4.3, cahier de
 * conformité §4.2)
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Purger » veut dire ici ce que ça veut dire partout ailleurs dans
 * AeroOS : renseigner `deletedAt` (cf. CLAUDE.md §2 — jamais de
 * suppression physique). Une ligne « purgée » disparaît des écrans
 * (tous les `findMany` filtrent `deletedAt: null`) mais reste en base,
 * comme n'importe quelle suppression métier.
 *
 * Règles (durées documentées cahier de conformité §4.2) :
 *   - Données financières (Payment)      : 10 ans après `dueDate`
 *   - Contrats (LeaseContract)           : 10 ans après `endDate`
 *   - Documents techniques (Document,
 *     catégories MAINTENANCE/INSPECTION) : jamais avant que l'actif
 *     lié lui-même soit retiré (`Aircraft.deletedAt` renseigné) —
 *     « durée de vie de l'actif », pas une durée fixe
 *   - Utilisateurs supprimés             : anonymisés (T4.2) si un
 *     compte a `deletedAt` renseigné depuis 30 jours ou plus sans
 *     l'être déjà — cas défensif : le seul chemin de suppression
 *     actuel (route RGPD) anonymise déjà de façon atomique, cette
 *     règle couvre une future désactivation de compte qui ne le
 *     ferait pas
 *   - Journal d'audit (audit_logs)       : **jamais touché** — ni lu
 *     ni écrit par ce script, quelle que soit son ancienneté (rétention
 *     7 ans minimum, immuabilité garantie par `prisma/rls.sql`)
 *
 * Dry-run par défaut : rapporte les lignes éligibles sans rien écrire.
 * `--execute` applique réellement les purges (une entrée d'audit par
 * ligne purgée).
 *
 * Usage :
 *   npm run retention:purge                       → tous les tenants, dry-run
 *   npm run retention:purge -- --execute           → tous les tenants, applique
 *   npm run retention:purge -- <slug>              → un tenant, dry-run
 *   npm run retention:purge -- <slug> --execute    → un tenant, applique
 */

import { prisma, withTenant, asSystem, audit } from '../src/lib/db';
import { eraseUserData, isAnonymizedEmail } from '../src/lib/gdpr';

const FINANCIAL_RETENTION_YEARS = 10;
const CONTRACT_RETENTION_YEARS_AFTER_EXPIRY = 10;
const USER_ANONYMIZE_AFTER_DAYS = 30;
const TECHNICAL_DOC_CATEGORIES = ['MAINTENANCE', 'INSPECTION'] as const;

function yearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

interface TenantSummary {
  tenantName: string;
  payments: number;
  contracts: number;
  documents: number;
  users: number;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const target = args.find((a) => !a.startsWith('--'));

  const tenants = await asSystem(
    'retention-purge: découverte des tenants actifs pour la revue de rétention',
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
    console.error(target ? `Aucun tenant actif correspondant à « ${target} »` : 'Aucun tenant actif.');
    process.exit(1);
  }

  console.log(
    `\n▶ Revue de rétention — ${tenants.length} tenant(s) — mode ${execute ? 'EXÉCUTION' : 'DRY-RUN (défaut)'}\n`
  );
  console.log('  Journal d\'audit : hors périmètre, jamais consulté ni modifié par ce script.\n');

  const financialCutoff = yearsAgo(FINANCIAL_RETENTION_YEARS);
  const contractCutoff = yearsAgo(CONTRACT_RETENTION_YEARS_AFTER_EXPIRY);
  const userCutoff = daysAgo(USER_ANONYMIZE_AFTER_DAYS);

  const summaries: TenantSummary[] = [];

  for (const tenant of tenants) {
    console.log(`── ${tenant.name} ──`);

    const summary: TenantSummary = { tenantName: tenant.name, payments: 0, contracts: 0, documents: 0, users: 0 };

    // ── Données financières : Payment.dueDate + 10 ans ──────────────
    const payments = await withTenant(tenant.id, (tx) =>
      tx.payment.findMany({
        where: { deletedAt: null, dueDate: { lt: financialCutoff } },
        select: { id: true, periodLabel: true, dueDate: true, contractId: true },
        orderBy: { dueDate: 'asc' },
      })
    );
    console.log(`  Paiements > ${FINANCIAL_RETENTION_YEARS} ans : ${payments.length}`);
    for (const p of payments) {
      console.log(`    · ${p.periodLabel} (échéance ${p.dueDate.toISOString().slice(0, 10)}) — ${p.id}`);
    }
    if (execute && payments.length > 0) {
      await withTenant(tenant.id, (tx) =>
        tx.payment.updateMany({
          where: { id: { in: payments.map((p) => p.id) } },
          data: { deletedAt: new Date() },
        })
      );
      for (const p of payments) {
        await audit({
          tenantId: tenant.id,
          action: 'DELETE',
          resourceType: 'Payment',
          resourceId: p.id,
          result: 'SUCCESS',
          metadata: { retentionPurge: true, reason: `dueDate > ${FINANCIAL_RETENTION_YEARS} ans`, dueDate: p.dueDate.toISOString() },
        });
      }
    }
    summary.payments = payments.length;

    // ── Contrats : LeaseContract.endDate + 10 ans ───────────────────
    const contracts = await withTenant(tenant.id, (tx) =>
      tx.leaseContract.findMany({
        where: { deletedAt: null, endDate: { lt: contractCutoff } },
        select: { id: true, reference: true, endDate: true },
        orderBy: { endDate: 'asc' },
      })
    );
    console.log(`  Contrats expirés depuis > ${CONTRACT_RETENTION_YEARS_AFTER_EXPIRY} ans : ${contracts.length}`);
    for (const c of contracts) {
      console.log(`    · ${c.reference} (expiré ${c.endDate.toISOString().slice(0, 10)}) — ${c.id}`);
    }
    if (execute && contracts.length > 0) {
      await withTenant(tenant.id, (tx) =>
        tx.leaseContract.updateMany({
          where: { id: { in: contracts.map((c) => c.id) } },
          data: { deletedAt: new Date() },
        })
      );
      for (const c of contracts) {
        await audit({
          tenantId: tenant.id,
          action: 'DELETE',
          resourceType: 'LeaseContract',
          resourceId: c.id,
          result: 'SUCCESS',
          metadata: { retentionPurge: true, reason: `endDate > ${CONTRACT_RETENTION_YEARS_AFTER_EXPIRY} ans`, endDate: c.endDate.toISOString() },
        });
      }
    }
    summary.contracts = contracts.length;

    // ── Documents techniques : liés à un actif déjà retiré ──────────
    const documents = await withTenant(tenant.id, (tx) =>
      tx.document.findMany({
        where: {
          deletedAt: null,
          category: { in: [...TECHNICAL_DOC_CATEGORIES] },
          aircraftId: { not: null },
          aircraft: { deletedAt: { not: null } },
        },
        select: { id: true, title: true, category: true, aircraftId: true },
      })
    );
    console.log(`  Documents techniques d'actifs retirés de flotte : ${documents.length}`);
    for (const d of documents) {
      console.log(`    · [${d.category}] ${d.title} — ${d.id}`);
    }
    if (execute && documents.length > 0) {
      await withTenant(tenant.id, (tx) =>
        tx.document.updateMany({
          where: { id: { in: documents.map((d) => d.id) } },
          data: { deletedAt: new Date() },
        })
      );
      for (const d of documents) {
        await audit({
          tenantId: tenant.id,
          action: 'DELETE',
          resourceType: 'Document',
          resourceId: d.id,
          result: 'SUCCESS',
          metadata: { retentionPurge: true, reason: 'actif retiré de flotte', aircraftId: d.aircraftId },
        });
      }
    }
    summary.documents = documents.length;

    // ── Utilisateurs supprimés non encore anonymisés depuis 30 jours ─
    const staleUsers = await withTenant(tenant.id, (tx) =>
      tx.user.findMany({
        where: { deletedAt: { not: null, lt: userCutoff } },
        select: { id: true, email: true, deletedAt: true },
      })
    ).then((users) => users.filter((u) => !isAnonymizedEmail(u.email)));
    console.log(`  Comptes supprimés depuis > ${USER_ANONYMIZE_AFTER_DAYS} j non anonymisés : ${staleUsers.length}`);
    for (const u of staleUsers) {
      console.log(`    · ${u.id} (supprimé le ${u.deletedAt!.toISOString().slice(0, 10)})`);
    }
    if (execute) {
      for (const u of staleUsers) {
        const result = await eraseUserData(tenant.id, u.id, {
          reason: `retention-purge: anonymisation différée (${USER_ANONYMIZE_AFTER_DAYS} j écoulés, T4.3)`,
        });
        if (!result.ok) {
          console.error(`    ✗ échec anonymisation ${u.id} : ${result.reason}`);
        }
      }
    }
    summary.users = staleUsers.length;

    summaries.push(summary);
    console.log();
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      payments: acc.payments + s.payments,
      contracts: acc.contracts + s.contracts,
      documents: acc.documents + s.documents,
      users: acc.users + s.users,
    }),
    { payments: 0, contracts: 0, documents: 0, users: 0 }
  );

  console.log('────────────────────────────────────────────────────────────');
  console.log(
    `▶ Total ${execute ? 'purgé' : 'éligible'} — paiements: ${totals.payments}, contrats: ${totals.contracts}, ` +
      `documents: ${totals.documents}, comptes anonymisés: ${totals.users}`
  );
  if (!execute) {
    console.log('  (dry-run — relancer avec --execute pour appliquer)');
  }
  console.log();

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Erreur fatale :', err);
  await prisma.$disconnect();
  process.exit(1);
});
