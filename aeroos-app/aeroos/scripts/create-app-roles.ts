/**
 * Crée les rôles applicatifs aeroos_app (NOBYPASSRLS) et aeroos_system
 * (BYPASSRLS) sur une base Postgres managée neuve (Railway, Fly.io…),
 * où l'on ne dispose que d'un rôle superuser — cf. TODO.md T5.4 point 2
 * et .env.example.
 *
 * Idempotent : peut être relancé sans erreur si les rôles existent déjà
 * (le mot de passe est alors mis à jour, pas régénéré).
 *
 * Usage :
 *   ADMIN_DATABASE_URL="postgresql://postgres:...@host:port/railway" \
 *     npx tsx scripts/create-app-roles.ts
 *
 * Les mots de passe générés ne sont affichés qu'une fois, en clair, sur
 * cette sortie — à copier immédiatement dans le gestionnaire de secrets
 * de la plateforme (DATABASE_URL, SYSTEM_DATABASE_URL), jamais dans le repo.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

function generatePassword(): string {
  // base64 sans caractères qui compliqueraient une URL de connexion
  return randomBytes(24).toString('base64').replace(/[+/=]/g, '');
}

async function createRole(
  client: Client,
  role: string,
  password: string,
  bypassRls: boolean
) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);

  if (exists.rows.length > 0) {
    await client.query(
      `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${password}' NOSUPERUSER ${bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'}`
    );
    console.log(`Rôle "${role}" déjà existant — mot de passe mis à jour.`);
  } else {
    await client.query(
      `CREATE ROLE "${role}" WITH LOGIN PASSWORD '${password}' NOSUPERUSER ${bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'}`
    );
    console.log(`Rôle "${role}" créé.`);
  }

  const dbName = client.database;
  await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${role}"`);
  await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`
  );
  await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`
  );
}

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) {
    console.error('ADMIN_DATABASE_URL manquant (connexion superuser requise pour CREATE ROLE).');
    process.exit(1);
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  const appPassword = process.env.APP_ROLE_PASSWORD || generatePassword();
  const systemPassword = process.env.SYSTEM_ROLE_PASSWORD || generatePassword();

  try {
    await createRole(client, 'aeroos_app', appPassword, false);
    await createRole(client, 'aeroos_system', systemPassword, true);
  } finally {
    await client.end();
  }

  const url = new URL(adminUrl);
  const buildUrl = (user: string, password: string) =>
    `postgresql://${user}:${password}@${url.host}${url.pathname}${url.search}`;

  console.log('\n─────────────────────────────────────────────────────────');
  console.log('À copier immédiatement dans le gestionnaire de secrets de');
  console.log('la plateforme (jamais dans le repo) :');
  console.log('─────────────────────────────────────────────────────────');
  console.log(`DATABASE_URL="${buildUrl('aeroos_app', appPassword)}"`);
  console.log(`SYSTEM_DATABASE_URL="${buildUrl('aeroos_system', systemPassword)}"`);
  console.log('─────────────────────────────────────────────────────────');
  console.log(
    'ADMIN_DATABASE_URL reste le superuser existant — à garder uniquement'
  );
  console.log('pour les migrations et npm run db:rls, pas au runtime applicatif.');
}

main().catch((err) => {
  console.error('Échec de la création des rôles :', err);
  process.exit(1);
});
