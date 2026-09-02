-- ═══════════════════════════════════════════════════════════════════
-- AeroOS — Row Level Security (décision D1 du cahier de conformité)
-- ═══════════════════════════════════════════════════════════════════
-- Ce script active l'isolation multi-tenant AU NIVEAU DE POSTGRES.
-- Une requête sans app.current_tenant défini retourne 0 ligne.
-- Une requête avec un tenant_id ne peut JAMAIS voir les données d'un autre.
--
-- C'est la différence entre "on filtre par tenantId dans le code" (fragile,
-- un oubli = fuite de données) et "la base refuse physiquement" (robuste).
--
-- À exécuter après `prisma migrate deploy` :
--   DATABASE_URL=<rôle superuser> npm run db:rls
-- (le script scripts/apply-rls.ts exécute ce fichier via `pg`, pas `psql` —
-- le binaire n'est pas garanti présent sur les plateformes de déploiement)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. Fonction utilitaire : récupère le tenant du contexte de session
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS text AS $$
BEGIN
  -- current_setting avec true = ne lève pas d'erreur si non défini
  -- tenantId est stocké en text (Prisma String sans @db.Uuid) : pas de cast uuid
  RETURN NULLIF(current_setting('app.current_tenant', true), '');
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────
-- 2. Activation RLS + politique sur chaque table métier
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users',
    'aircraft',
    'engines',
    'components',
    'operators',
    'lease_contracts',
    'payments',
    'documents',
    'valuation_records',
    'maintenance_tasks',
    'asset_events',
    'alerts',
    'portfolios',
    'ai_extractions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Active RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);

    -- FORCE : s'applique même au propriétaire de la table
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    -- Supprime une éventuelle politique existante (idempotence)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);

    -- Politique : lecture ET écriture limitées au tenant courant
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_tenant_id())
        WITH CHECK ("tenantId" = current_tenant_id());
    $f$, t);

    RAISE NOTICE 'RLS activé sur %', t;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 3. Table tenants — accessible uniquement au rôle admin applicatif
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_access ON tenants;
CREATE POLICY tenant_self_access ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- ─────────────────────────────────────────────────────────────────
-- 4. Audit log — APPEND ONLY (décision D3)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_insert ON audit_logs;
DROP POLICY IF EXISTS audit_select ON audit_logs;

-- Insertion : autorisée pour le tenant courant
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT
  WITH CHECK ("tenantId" = current_tenant_id());

-- Lecture : autorisée pour le tenant courant
CREATE POLICY audit_select ON audit_logs
  FOR SELECT
  USING ("tenantId" = current_tenant_id());

-- Pas de policy UPDATE ni DELETE = ces opérations sont impossibles.
-- C'est ce qui rend l'audit log immuable.

-- Blindage supplémentaire : trigger qui rejette toute tentative
CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est append-only : UPDATE et DELETE sont interdits';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON audit_logs;
CREATE TRIGGER audit_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- ─────────────────────────────────────────────────────────────────
-- 5. Recherche full-text sur les documents (Document Vault)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION documents_search_trigger()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('french', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('french', coalesce(NEW.subcategory, '')), 'B') ||
    setweight(to_tsvector('french', coalesce(NEW."extractedText", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_search_update ON documents;
CREATE TRIGGER documents_search_update
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_search_trigger();

CREATE INDEX IF NOT EXISTS documents_search_idx
  ON documents USING GIN(search_vector);

-- ─────────────────────────────────────────────────────────────────
-- 6. Rôle applicatif non-superuser (RLS ne s'applique pas aux superusers)
-- ─────────────────────────────────────────────────────────────────
-- À exécuter manuellement en production avec un mot de passe fort :
--
--   CREATE ROLE aeroos_app WITH LOGIN PASSWORD '<strong-password>';
--   GRANT CONNECT ON DATABASE aeroos TO aeroos_app;
--   GRANT USAGE ON SCHEMA public TO aeroos_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aeroos_app;
--   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aeroos_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aeroos_app;
--
-- Puis DATABASE_URL utilise aeroos_app, PAS le superuser postgres.
-- Sans cela, RLS est contourné silencieusement.

-- ─────────────────────────────────────────────────────────────────
-- Vérification
-- ─────────────────────────────────────────────────────────────────
SELECT
  n.nspname AS schemaname,
  c.relname AS tablename,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY tablename;
