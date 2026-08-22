-- AlterTable
-- Cette colonne est déjà créée et alimentée par un trigger dans
-- prisma/rls.sql §5 (documents_search_trigger) — IF NOT EXISTS pour
-- rester idempotent dans les environnements où rls.sql a déjà tourné.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_search_idx" ON "documents" USING GIN ("search_vector");
