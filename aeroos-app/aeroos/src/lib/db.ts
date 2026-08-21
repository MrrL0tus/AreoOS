/**
 * AeroOS — Accès base de données avec isolation multi-tenant
 * ═══════════════════════════════════════════════════════════════════
 *
 * Règle absolue : on n'accède JAMAIS à la base sans contexte tenant.
 *
 * Le pattern utilisé ici combine deux couches de protection :
 *   1. Postgres RLS (prisma/rls.sql) — la base refuse physiquement
 *   2. withTenant() — l'application définit le contexte de session
 *
 * Si l'une des deux est oubliée, l'autre protège encore. C'est
 * volontaire : la sécurité multi-tenant ne doit pas dépendre d'un
 * développeur qui pense à ajouter `where: { tenantId }`.
 */

import { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────
// Singleton Prisma (évite l'épuisement du pool en dev avec HMR)
// ─────────────────────────────────────────────────────────────────
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─────────────────────────────────────────────────────────────────
// withTenant — exécute une requête dans le contexte d'un tenant
// ─────────────────────────────────────────────────────────────────

/**
 * Exécute un bloc de requêtes avec le contexte tenant défini.
 *
 * Toutes les requêtes à l'intérieur du callback sont automatiquement
 * limitées au tenant, y compris les requêtes que vous oublieriez de
 * filtrer manuellement.
 *
 * @example
 * const aircraft = await withTenant(tenantId, (tx) =>
 *   tx.aircraft.findMany()  // ne retourne QUE les avions de ce tenant
 * );
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> {
  if (!tenantId || !isUuid(tenantId)) {
    throw new TenantContextError(
      'tenantId manquant ou invalide — accès base refusé'
    );
  }

  return prisma.$transaction(async (tx) => {
    // set_config avec is_local=true : le réglage est limité à cette transaction
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant', $1, true)`,
      tenantId
    );

    return fn(tx);
  });
}

/**
 * Client connecté avec le rôle Postgres BYPASSRLS (SYSTEM_DATABASE_URL).
 * Ne JAMAIS exporter ni utiliser directement — seul asSystem() y accède,
 * pour garder une trace de chaque contournement du RLS.
 */
const globalForSystemPrisma = globalThis as unknown as {
  systemPrisma: PrismaClient | undefined;
};

function getSystemPrisma(): PrismaClient {
  if (!globalForSystemPrisma.systemPrisma) {
    globalForSystemPrisma.systemPrisma = new PrismaClient({
      datasources: { db: { url: process.env.SYSTEM_DATABASE_URL } },
    });
  }
  return globalForSystemPrisma.systemPrisma;
}

/**
 * Version admin — contourne le RLS pour les opérations système
 * (création de tenant, migrations, tâches de fond multi-tenant, recherche
 * d'un utilisateur par e-mail avant de connaître son tenant lors du login).
 *
 * Contrairement à withTenant(), la protection ne vient pas de l'application
 * mais est structurelle : la connexion utilise un rôle Postgres BYPASSRLS
 * dédié (SYSTEM_DATABASE_URL), distinct du rôle applicatif normal.
 *
 * À utiliser avec parcimonie et TOUJOURS avec un log d'audit.
 */
export async function asSystem<T>(
  reason: string,
  fn: (client: PrismaClient) => Promise<T>
): Promise<T> {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SYSTEM_ACCESS) {
    throw new Error(
      'asSystem() désactivé en production sans ALLOW_SYSTEM_ACCESS'
    );
  }
  console.warn(`[SYSTEM ACCESS] ${reason}`);
  return fn(getSystemPrisma());
}

// ─────────────────────────────────────────────────────────────────
// Audit log — écriture append-only
// ─────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  | 'VIEW'
  | 'AI_EXTRACT'
  | 'AI_VALIDATE';

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  userEmail?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  result?: 'SUCCESS' | 'DENIED' | 'ERROR';
  metadata?: Record<string, unknown>;
}

/**
 * Écrit une entrée d'audit. Ne lève jamais d'exception : un échec
 * d'audit ne doit pas casser l'opération métier, mais il est loggé.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await withTenant(entry.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId,
          userEmail: entry.userEmail,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          result: entry.result ?? 'SUCCESS',
          metadata: entry.metadata as never,
        },
      })
    );
  } catch (err) {
    console.error('[AUDIT FAILURE]', err, entry);
  }
}

// ─────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Convertit les Decimal Prisma en number pour la sérialisation JSON.
 * Prisma retourne des Decimal.js qui ne passent pas dans JSON.stringify.
 */
export function serializeDecimals<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      value !== null && typeof value === 'object' && 'toNumber' in value
        ? (value as { toNumber: () => number }).toNumber()
        : value
    )
  );
}
