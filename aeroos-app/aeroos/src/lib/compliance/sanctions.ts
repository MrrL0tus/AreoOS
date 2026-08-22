/**
 * AeroOS — Screening des sanctions (T4.1, cahier de conformité §5)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Compare le nom d'un opérateur à la liste de référence des entités
 * sanctionnées (SanctionedEntity — table globale, sans tenantId, cf.
 * schema.prisma). La comparaison est approximative (distance de
 * Levenshtein normalisée) car les listes officielles contiennent des
 * variantes de translittération, abréviations, alias.
 *
 * Seuils (documentés cahier de conformité §5.4) :
 *   - correspondance exacte (normalisée)         → BLOCKED
 *   - similarité ≥ 0.85 sans correspondance exacte → FLAGGED (revue humaine)
 *   - sinon                                       → CLEAR
 *
 * Le screening est un signal, pas une décision automatique définitive :
 * un statut FLAGGED ou BLOCKED reste modifiable par un utilisateur
 * COMPLIANCE_OFFICER/ADMIN via sanctionsNotes (hors périmètre T4.1, pas
 * d'UI de révision — seule la lecture existe aujourd'hui).
 */

import { withTenant, audit } from '@/lib/db';
import type { SanctionsStatus } from '@prisma/client';

const FLAG_THRESHOLD = 0.85;

/**
 * Distance de Levenshtein classique (nombre d'éditions single-char).
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // suppression
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Normalise un nom pour comparaison : minuscules, accents retirés,
 * ponctuation/espaces multiples réduits — évite les faux négatifs dus
 * à la casse ou au formatage ("S.A." vs "SA", espaces insécables…).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Similarité normalisée entre 0 (aucun rapport) et 1 (identique), basée
 * sur la distance de Levenshtein rapportée à la longueur du plus long nom.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(na, nb);
  return 1 - dist / maxLen;
}

export interface SanctionMatch {
  entityId: string;
  entityName: string;
  program: string | null;
  source: string;
  similarity: number;
}

export interface ScreenNameResult {
  status: SanctionsStatus;
  bestMatch: SanctionMatch | null;
  matches: SanctionMatch[];
}

/**
 * Compare un nom libre à la liste de référence. Ne touche à aucune
 * donnée tenant — la table sanctioned_entities est globale et hors RLS.
 */
export async function screenName(
  name: string,
  tx: {
    sanctionedEntity: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: (args?: any) => Promise<Array<{ id: string; name: string; program: string | null; source: string }>>;
    };
  }
): Promise<ScreenNameResult> {
  const candidates = await tx.sanctionedEntity.findMany();

  const matches: SanctionMatch[] = candidates
    .map((entity) => ({
      entityId: entity.id,
      entityName: entity.name,
      program: entity.program,
      source: entity.source,
      similarity: similarity(name, entity.name),
    }))
    .filter((m) => m.similarity >= FLAG_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  const bestMatch = matches[0] ?? null;
  const status: SanctionsStatus =
    bestMatch === null ? 'CLEAR' : bestMatch.similarity >= 0.999 ? 'BLOCKED' : 'FLAGGED';

  return { status, bestMatch, matches };
}

export interface ScreenOperatorMeta {
  userId?: string;
  userEmail?: string;
  reason: string; // ex. "création opérateur", "revue annuelle programmée"
}

export interface ScreenOperatorResult {
  operatorId: string;
  operatorName: string;
  previousStatus: SanctionsStatus;
  status: SanctionsStatus;
  bestMatch: SanctionMatch | null;
}

/**
 * Screening d'un opérateur : recherche de correspondance, mise à jour
 * de son statut sanctions, et journal d'audit (toujours écrit, même si
 * le statut ne change pas — la date de vérification, elle, change).
 */
export async function screenOperator(
  tenantId: string,
  operatorId: string,
  meta: ScreenOperatorMeta
): Promise<ScreenOperatorResult> {
  const result = await withTenant(tenantId, async (tx) => {
    const operator = await tx.operator.findFirst({
      where: { id: operatorId, deletedAt: null },
      select: { id: true, name: true, sanctionsStatus: true },
    });
    if (!operator) {
      throw new Error(`screenOperator: opérateur ${operatorId} introuvable`);
    }

    const { status, bestMatch } = await screenName(operator.name, tx);

    const notes = bestMatch
      ? `Correspondance « ${bestMatch.entityName} » (${bestMatch.source}${bestMatch.program ? `, ${bestMatch.program}` : ''}) — similarité ${(bestMatch.similarity * 100).toFixed(0)}%`
      : null;

    await tx.operator.update({
      where: { id: operator.id },
      data: {
        sanctionsStatus: status,
        sanctionsCheckedAt: new Date(),
        sanctionsNotes: notes,
      },
    });

    return {
      operatorId: operator.id,
      operatorName: operator.name,
      previousStatus: operator.sanctionsStatus,
      status,
      bestMatch,
    };
  });

  await audit({
    tenantId,
    userId: meta.userId,
    userEmail: meta.userEmail,
    action: 'UPDATE',
    resourceType: 'Operator',
    resourceId: result.operatorId,
    result: 'SUCCESS',
    metadata: {
      screening: meta.reason,
      previousStatus: result.previousStatus,
      newStatus: result.status,
      matchedEntity: result.bestMatch?.entityName ?? null,
      matchedSource: result.bestMatch?.source ?? null,
      matchedSimilarity: result.bestMatch?.similarity ?? null,
    },
  });

  return result;
}
