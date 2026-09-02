/**
 * Applique prisma/rls.sql sur la base pointée par DATABASE_URL.
 *
 * Remplace l'appel direct à `psql` : le binaire n'est pas garanti présent
 * dans l'image de build d'une plateforme comme Railway, qui ne fournit
 * qu'un runtime Node (cf. TODO.md T5.4). `pg` parle directement le
 * protocole Postgres, comme le fait déjà Prisma en interne — ce n'est pas
 * un ORM ni un query builder concurrent, seulement le driver de transport.
 *
 * À exécuter avec le rôle superuser (ADMIN_DATABASE_URL) : rls.sql modifie
 * des politiques et crée des triggers, hors de portée du rôle applicatif.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL manquant.');
    process.exit(1);
  }

  const sql = readFileSync(join(__dirname, '..', 'prisma', 'rls.sql'), 'utf-8');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Un seul appel avec du texte brut (pas de $1, $2…) : pg utilise le
    // protocole simple, qui — contrairement au protocole étendu de Prisma —
    // accepte plusieurs commandes séparées par ";", y compris les blocs
    // DO $$ ... $$ de rls.sql.
    const result = await client.query(sql);
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    if (last?.rows?.length) {
      console.table(last.rows);
    }
    console.log('Politiques RLS appliquées avec succès.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Échec de l’application des politiques RLS :', err);
  process.exit(1);
});
