/**
 * AeroOS — Export et effacement RGPD (T4.2, RGPD articles 15 et 17)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Deux opérations, toutes deux réservées à un ADMIN et scopées à un
 * utilisateur de son propre tenant (RLS via withTenant()) :
 *
 *   - exportUserData()  : article 15, droit d'accès — renvoie toutes
 *     les données personnelles connues d'un utilisateur.
 *   - eraseUserData()   : article 17, droit à l'effacement — anonymise
 *     l'utilisateur (jamais de suppression physique, cf. CLAUDE.md §2).
 *
 * Limite documentée : le journal d'audit (`audit_logs`) est append-only
 * au niveau base (trigger `reject_audit_mutation`, FORCE ROW LEVEL
 * SECURITY — cf. prisma/rls.sql) et n'est donc jamais modifié, y compris
 * par l'effacement. Les entrées passées conservent l'e-mail tel qu'il
 * était au moment des faits ; c'est le comportement voulu (rule D3 —
 * intégrité de la piste d'audit) et une base légale RGPD standard pour
 * les logs de sécurité/conformité (art. 17§3-b), déjà cohérente avec la
 * rétention de 7 ans du journal d'audit prévue en T4.3, qui survit elle
 * aussi à l'effacement d'un utilisateur.
 */

import { randomUUID } from 'crypto';
import { withTenant, audit } from './db';
import { hashPassword } from './auth';

export interface ExportedUserData {
  exportedAt: string;
  tenantId: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  auditEntries: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    result: string;
    ipAddress: string | null;
    createdAt: string;
  }>;
  actions: {
    assetEventsCreated: Array<{
      id: string;
      aircraftId: string;
      eventType: string;
      eventDate: string;
      title: string;
      createdAt: string;
    }>;
    alertsAssigned: Array<{
      id: string;
      type: string;
      title: string;
      dueDate: string | null;
      isRead: boolean;
      resolvedAt: string | null;
      createdAt: string;
    }>;
    aiExtractionsValidated: Array<{
      id: string;
      documentId: string;
      status: string;
      validatedAt: string | null;
      corrections: unknown;
    }>;
  };
}

/**
 * Article 15 — export de toutes les données personnelles connues d'un
 * utilisateur du tenant courant. N'inclut jamais passwordHash, mfaSecret
 * ni mfaRecoveryCodes : ce sont des secrets de sécurité, pas des données
 * que le titulaire a besoin de recevoir en clair.
 */
export async function exportUserData(
  tenantId: string,
  targetUserId: string
): Promise<ExportedUserData | null> {
  return withTenant(tenantId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        mfaEnabled: true,
        lastLoginAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return null;

    const [auditEntries, assetEvents, alerts, extractions] = await Promise.all([
      tx.auditLog.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          result: true,
          ipAddress: true,
          createdAt: true,
        },
      }),
      tx.assetEvent.findMany({
        where: { createdById: targetUserId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          aircraftId: true,
          eventType: true,
          eventDate: true,
          title: true,
          createdAt: true,
        },
      }),
      tx.alert.findMany({
        where: { assignedToId: targetUserId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          dueDate: true,
          isRead: true,
          resolvedAt: true,
          createdAt: true,
        },
      }),
      tx.aiExtraction.findMany({
        where: { validatedById: targetUserId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          documentId: true,
          status: true,
          validatedAt: true,
          corrections: true,
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      tenantId,
      user: {
        ...user,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      auditEntries: auditEntries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      actions: {
        assetEventsCreated: assetEvents.map((e) => ({
          ...e,
          eventDate: e.eventDate.toISOString(),
          createdAt: e.createdAt.toISOString(),
        })),
        alertsAssigned: alerts.map((a) => ({
          ...a,
          dueDate: a.dueDate?.toISOString() ?? null,
          resolvedAt: a.resolvedAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
        aiExtractionsValidated: extractions.map((x) => ({
          ...x,
          validatedAt: x.validatedAt?.toISOString() ?? null,
        })),
      },
    };
  });
}

export type EraseUserResult =
  | { ok: true; anonymizedEmail: string }
  | { ok: false; reason: 'not_found' | 'already_erased' };

/** Détecte un e-mail déjà anonymisé par eraseUserData() (idempotence). */
export function isAnonymizedEmail(email: string): boolean {
  return /^deleted-[0-9a-f-]{36}@anonymized\.local$/i.test(email);
}

/**
 * Article 17 — anonymisation (jamais de suppression physique). Les
 * relations existantes (audit_logs.userId, AssetEvent.createdById,
 * Alert.assignedToId, AiExtraction.validatedById) restent intactes :
 * seul le profil est rendu non identifiant.
 *
 * `deletedAt` fait aussi office de coupe-circuit immédiat : getSession()
 * revérifie `deletedAt: null` en base à chaque requête (cf. auth.ts),
 * donc toute session active de cet utilisateur est invalidée dès
 * l'appel, sans mécanisme supplémentaire.
 *
 * Réutilisée par deux appelants : la route RGPD (T4.2, un ADMIN humain
 * agit sur demande explicite — `meta.adminUserId` renseigné) et le job
 * de rétention (T4.3, `retention-purge.ts` — acteur automatisé, pas
 * d'utilisateur humain, `meta.adminUserId` omis). L'idempotence se
 * vérifie sur l'e-mail (déjà anonymisé ou non), pas sur `deletedAt` :
 * un compte peut être désactivé (`deletedAt` renseigné par un autre
 * mécanisme) sans être encore anonymisé — c'est précisément le cas que
 * T4.3 détecte et corrige après 30 jours. Le `deletedAt` d'origine est
 * conservé s'il existait déjà (date réelle de désactivation).
 */
export async function eraseUserData(
  tenantId: string,
  targetUserId: string,
  meta: { adminUserId?: string; adminEmail?: string; reason: string }
): Promise<EraseUserResult> {
  const anonymizedEmail = `deleted-${randomUUID()}@anonymized.local`;
  // Hash bcrypt valide sur un secret aléatoire jeté : aucun mot de passe
  // ne pourra plus jamais correspondre, sans laisser un format de hash
  // invalide qui ferait planter un futur bcrypt.compare().
  const inertPasswordHash = await hashPassword(randomUUID());

  const result = await withTenant(tenantId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: targetUserId },
      select: { id: true, email: true, deletedAt: true },
    });
    if (!user) return { ok: false as const, reason: 'not_found' as const };
    if (isAnonymizedEmail(user.email)) {
      return { ok: false as const, reason: 'already_erased' as const };
    }

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        email: anonymizedEmail,
        firstName: '[supprimé]',
        lastName: '[supprimé]',
        passwordHash: inertPasswordHash,
        deletedAt: user.deletedAt ?? new Date(),
      },
    });

    return { ok: true as const, anonymizedEmail };
  });

  if (result.ok) {
    await audit({
      tenantId,
      userId: meta.adminUserId,
      userEmail: meta.adminEmail,
      action: 'DELETE',
      resourceType: 'User',
      resourceId: targetUserId,
      result: 'SUCCESS',
      metadata: { gdpr: 'article17', reason: meta.reason },
    });
  }

  return result;
}
