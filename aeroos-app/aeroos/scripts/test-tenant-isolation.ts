/**
 * AeroOS — Test d'isolation multi-tenant
 * ═══════════════════════════════════════════════════════════════════
 *
 * Ce test prouve que la décision D1 du cahier de conformité est
 * réellement appliquée : un tenant ne peut PAS voir les données
 * d'un autre tenant, même si le code applicatif oublie de filtrer.
 *
 * C'est le test que vous montrez à un investisseur ou à un client
 * enterprise qui demande "comment garantissez-vous l'isolation ?".
 *
 *   npm run test:isolation
 *
 * ⚠️  Ce test DOIT tourner dans la CI/CD. S'il échoue, c'est une
 * faille de sécurité critique — le déploiement doit être bloqué.
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { withTenant, prisma as appPrisma } from '../src/lib/db';

// Préparation/nettoyage : opération système qui doit contourner le RLS
// pour créer un tenant avant qu'un contexte tenant n'existe (cf. .env
// ADMIN_DATABASE_URL). Les assertions du test, elles, passent par
// withTenant() / appPrisma ci-dessous, connectés en rôle applicatif.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.ADMIN_DATABASE_URL } },
});

// ─── Affichage ────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function ok(msg: string, detail?: string) {
  passed++;
  console.log(`   ${GREEN}✓${RESET} ${msg}`);
  if (detail) console.log(`     ${DIM}${detail}${RESET}`);
}

function fail(msg: string, detail?: string) {
  failed++;
  console.log(`   ${RED}✗ ÉCHEC${RESET} ${msg}`);
  if (detail) console.log(`     ${RED}${detail}${RESET}`);
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${BOLD}🔒 AeroOS — Test d'isolation multi-tenant${RESET}\n`);

  // ─────────────────────────────────────────────────────────────
  // Préparation : deux tenants distincts
  // ─────────────────────────────────────────────────────────────
  console.log(`${BOLD}Préparation${RESET}`);

  const tenantA_id = randomUUID();
  const tenantB_id = randomUUID();

  // Nettoyage préalable
  await cleanup([tenantA_id, tenantB_id]);

  await prisma.tenant.create({
    data: { id: tenantA_id, name: 'TEST Alpha Leasing', plan: 'PROFESSIONAL' },
  });
  await prisma.tenant.create({
    data: { id: tenantB_id, name: 'TEST Bravo Aviation', plan: 'PROFESSIONAL' },
  });
  ok('Deux tenants de test créés');

  // Chaque tenant crée un avion via withTenant
  const acA = await withTenant(tenantA_id, (tx) =>
    tx.aircraft.create({
      data: {
        tenantId: tenantA_id, msn: 'TEST-AAA-001', manufacturer: 'Airbus',
        model: 'A320', variant: '-200', yearBuilt: 2015,
        totalHours: 10000, totalCycles: 7000, status: 'ON_LEASE',
        registration: 'F-TEST-A',
      },
    })
  );

  const acB = await withTenant(tenantB_id, (tx) =>
    tx.aircraft.create({
      data: {
        tenantId: tenantB_id, msn: 'TEST-BBB-001', manufacturer: 'Boeing',
        model: 'B737', variant: '-800', yearBuilt: 2016,
        totalHours: 12000, totalCycles: 9000, status: 'ON_LEASE',
        registration: 'G-TEST-B',
      },
    })
  );
  ok('Un avion créé dans chaque tenant');

  // ─────────────────────────────────────────────────────────────
  // TEST 1 — Lecture limitée au tenant
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 1 — Lecture croisée${RESET}`);

  const listA = await withTenant(tenantA_id, (tx) =>
    tx.aircraft.findMany({ where: { msn: { startsWith: 'TEST-' } } })
  );

  if (listA.length === 1 && listA[0].msn === 'TEST-AAA-001') {
    ok('Tenant A ne voit que son propre avion',
       `${listA.length} résultat — MSN ${listA[0].msn}`);
  } else {
    fail('Tenant A voit des données qui ne lui appartiennent pas',
         `${listA.length} résultats : ${listA.map(a => a.msn).join(', ')}`);
  }

  const listB = await withTenant(tenantB_id, (tx) =>
    tx.aircraft.findMany({ where: { msn: { startsWith: 'TEST-' } } })
  );

  if (listB.length === 1 && listB[0].msn === 'TEST-BBB-001') {
    ok('Tenant B ne voit que son propre avion',
       `${listB.length} résultat — MSN ${listB[0].msn}`);
  } else {
    fail('Tenant B voit des données qui ne lui appartiennent pas',
         `${listB.length} résultats : ${listB.map(a => a.msn).join(', ')}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 2 — Accès direct par ID (le cas le plus dangereux)
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 2 — Accès direct par ID connu${RESET}`);
  console.log(`   ${DIM}Simule un attaquant qui devine ou intercepte un UUID${RESET}`);

  const stolen = await withTenant(tenantA_id, (tx) =>
    tx.aircraft.findUnique({ where: { id: acB.id } })
  );

  if (stolen === null) {
    ok("Tenant A ne peut pas lire l'avion de Tenant B par son ID",
       'findUnique retourne null malgré un ID valide');
  } else {
    fail('FUITE DE DONNÉES : Tenant A a lu un avion de Tenant B',
         `MSN exposé : ${stolen.msn}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 3 — Modification croisée
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 3 — Modification croisée${RESET}`);

  let updateBlocked = false;
  try {
    await withTenant(tenantA_id, (tx) =>
      tx.aircraft.update({
        where: { id: acB.id },
        data: { registration: 'HACKED' },
      })
    );
  } catch {
    updateBlocked = true;
  }

  // Vérification indépendante
  const checkB = await withTenant(tenantB_id, (tx) =>
    tx.aircraft.findUnique({ where: { id: acB.id } })
  );

  if (updateBlocked && checkB?.registration === 'G-TEST-B') {
    ok("Tenant A ne peut pas modifier l'avion de Tenant B",
       'Immatriculation intacte : G-TEST-B');
  } else {
    fail('Modification croisée possible',
         `Immatriculation actuelle : ${checkB?.registration}`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4 — Suppression croisée
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 4 — Suppression croisée${RESET}`);

  let deleteBlocked = false;
  try {
    await withTenant(tenantA_id, (tx) =>
      tx.aircraft.delete({ where: { id: acB.id } })
    );
  } catch {
    deleteBlocked = true;
  }

  const stillExists = await withTenant(tenantB_id, (tx) =>
    tx.aircraft.findUnique({ where: { id: acB.id } })
  );

  if (deleteBlocked && stillExists !== null) {
    ok("Tenant A ne peut pas supprimer l'avion de Tenant B");
  } else {
    fail('Suppression croisée possible — perte de données');
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 5 — Injection de tenantId falsifié
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 5 — Création avec tenantId falsifié${RESET}`);
  console.log(`   ${DIM}Le code applicatif tente d'écrire dans un autre tenant${RESET}`);

  let insertBlocked = false;
  try {
    await withTenant(tenantA_id, (tx) =>
      tx.aircraft.create({
        data: {
          tenantId: tenantB_id, // ← tentative d'écriture chez B
          msn: 'TEST-INJECT-001', manufacturer: 'Airbus', model: 'A350',
          yearBuilt: 2020, totalHours: 0, totalCycles: 0,
        },
      })
    );
  } catch {
    insertBlocked = true;
  }

  const injected = await withTenant(tenantB_id, (tx) =>
    tx.aircraft.findFirst({ where: { msn: 'TEST-INJECT-001' } })
  );

  if (insertBlocked && injected === null) {
    ok('WITH CHECK bloque l\'écriture dans un autre tenant',
       'La politique RLS refuse l\'INSERT');
  } else {
    fail('Écriture cross-tenant possible — corruption de données');
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 6 — Requête sans contexte tenant
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 6 — Requête sans contexte tenant${RESET}`);

  // Utilise le client applicatif (rôle non-superuser) : la connexion
  // admin utilisée pour la préparation ci-dessus contourne le RLS et
  // fausserait ce test.
  const noContext = await appPrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint as count FROM aircraft WHERE msn LIKE 'TEST-%'`
  );

  const visibleCount = Number(noContext[0]?.count ?? -1);

  if (visibleCount === 0) {
    ok('Sans app.current_tenant, aucune ligne visible',
       'RLS bloque par défaut — pas de fuite par oubli');
  } else {
    fail('Des données sont visibles sans contexte tenant',
         `${visibleCount} lignes exposées — RLS non actif ou rôle superuser`);
    console.log(
      `     ${YELLOW}→ Vérifiez : (1) prisma/rls.sql exécuté, ` +
      `(2) DATABASE_URL n'utilise PAS un superuser${RESET}`
    );
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 7 — Audit log immuable
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 7 — Immuabilité de l'audit log${RESET}`);

  const logEntry = await withTenant(tenantA_id, (tx) =>
    tx.auditLog.create({
      data: {
        tenantId: tenantA_id, action: 'CREATE', resourceType: 'Aircraft',
        resourceId: acA.id, result: 'SUCCESS', userEmail: 'test@test.com',
      },
    })
  );
  ok('Écriture dans audit_logs autorisée');

  let auditUpdateBlocked = false;
  try {
    await withTenant(tenantA_id, (tx) =>
      tx.auditLog.update({
        where: { id: logEntry.id },
        data: { result: 'FALSIFIED' },
      })
    );
  } catch {
    auditUpdateBlocked = true;
  }

  if (auditUpdateBlocked) {
    ok('Modification de l\'audit log impossible',
       'Trigger reject_audit_mutation actif');
  } else {
    fail('L\'audit log peut être modifié — non conforme');
  }

  let auditDeleteBlocked = false;
  try {
    await withTenant(tenantA_id, (tx) =>
      tx.auditLog.delete({ where: { id: logEntry.id } })
    );
  } catch {
    auditDeleteBlocked = true;
  }

  if (auditDeleteBlocked) {
    ok('Suppression de l\'audit log impossible');
  } else {
    fail('L\'audit log peut être supprimé — non conforme');
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 8 — Contexte tenant invalide
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Test 8 — Contexte tenant invalide${RESET}`);

  let rejected = false;
  try {
    await withTenant('pas-un-uuid', (tx) => tx.aircraft.findMany());
  } catch (e) {
    rejected = e instanceof Error && e.name === 'TenantContextError';
  }

  if (rejected) {
    ok('withTenant() rejette un tenantId malformé');
  } else {
    fail('withTenant() accepte un tenantId invalide');
  }

  // ─────────────────────────────────────────────────────────────
  // Nettoyage
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Nettoyage${RESET}`);
  await cleanup([tenantA_id, tenantB_id]);
  ok('Données de test supprimées');

  // ─────────────────────────────────────────────────────────────
  // Verdict
  // ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  const total = passed + failed;

  if (failed === 0) {
    console.log(
      `${GREEN}${BOLD}✅ ${passed}/${total} tests réussis` +
      ` — isolation multi-tenant vérifiée${RESET}\n`
    );
    process.exit(0);
  } else {
    console.log(
      `${RED}${BOLD}❌ ${failed}/${total} tests en échec` +
      ` — FAILLE DE SÉCURITÉ${RESET}`
    );
    console.log(
      `${RED}Le déploiement doit être bloqué jusqu'à résolution.${RESET}\n`
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────
async function cleanup(tenantIds: string[]) {
  for (const id of tenantIds) {
    // Suppression directe hors RLS (superuser en dev)
    await prisma.$executeRawUnsafe(
      `DELETE FROM audit_logs WHERE "tenantId" = $1`, id
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM aircraft WHERE "tenantId" = $1`, id
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = $1`, id
    ).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error(`\n${RED}Erreur fatale :${RESET}`, e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
