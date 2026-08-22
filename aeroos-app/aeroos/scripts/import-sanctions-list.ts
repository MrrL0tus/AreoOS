/**
 * AeroOS — Import d'une liste de sanctions (T4.1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Charge un CSV (colonnes : name, program?) dans la table de référence
 * globale sanctioned_entities. Idempotent : upsert sur [name, source],
 * relancer l'import avec le même fichier ne crée pas de doublons.
 *
 * Usage :
 *   npm run sanctions:import -- <fichier.csv> "<source>" "<date liste YYYY-MM-DD>"
 *
 * Exemple (jeu d'exemple fourni, données fictives — cf. prisma/sanctions/README.md) :
 *   npm run sanctions:import -- prisma/sanctions/sdn-sample.csv "OFAC SDN List (SAMPLE)" 2026-08-01
 */

import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { prisma } from '../src/lib/db';

interface Row {
  name?: string;
  program?: string;
}

async function main() {
  const [filePath, source, listDateStr] = process.argv.slice(2);

  if (!filePath || !source || !listDateStr) {
    console.error(
      'Usage : npm run sanctions:import -- <fichier.csv> "<source>" "<date liste YYYY-MM-DD>"'
    );
    process.exit(1);
  }

  const listDate = new Date(listDateStr);
  if (Number.isNaN(listDate.getTime())) {
    console.error(`Date de liste invalide : « ${listDateStr} » (attendu YYYY-MM-DD)`);
    process.exit(1);
  }

  const text = readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });

  if (parsed.errors.length > 0) {
    console.error('Erreurs de lecture CSV :', parsed.errors);
    process.exit(1);
  }

  const rows = parsed.data
    .map((r) => ({ name: r.name?.trim() ?? '', program: r.program?.trim() || null }))
    .filter((r) => r.name.length > 0);

  if (rows.length === 0) {
    console.error('Aucune ligne exploitable dans le fichier.');
    process.exit(1);
  }

  console.log(`\n▶ Import sanctions — ${rows.length} entité(s) — source « ${source} »\n`);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const result = await prisma.sanctionedEntity.upsert({
      where: { name_source: { name: row.name, source } },
      create: { name: row.name, program: row.program, source, listDate },
      update: { program: row.program, listDate },
    });
    // upsert ne dit pas directement s'il a créé ou mis à jour — on le
    // déduit en comparant createdAt à l'exécution (tolérance 2s).
    if (Date.now() - result.createdAt.getTime() < 2000) {
      created++;
    } else {
      updated++;
    }
    console.log(`  · ${row.name}${row.program ? ` (${row.program})` : ''}`);
  }

  console.log(`\n▶ Terminé — ${created} créée(s), ${updated} mise(s) à jour\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Erreur fatale :', err);
  await prisma.$disconnect();
  process.exit(1);
});
