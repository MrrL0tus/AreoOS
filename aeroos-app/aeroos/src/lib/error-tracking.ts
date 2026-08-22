/**
 * AeroOS — Suivi des erreurs (T5.3)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sentry est optionnel : sans `SENTRY_DSN`, `captureException()` se
 * réduit à un log structuré (toujours actif, jamais perdu). Avec
 * `SENTRY_DSN`, l'erreur est en plus envoyée à Sentry.
 *
 * ⚠️ `context` ne doit jamais contenir d'e-mail, de mot de passe ni de
 * contenu de contrat (cf. logger.ts, CLAUDE.md règle 6) — uniquement
 * des identifiants (`tenantId`, `userId`, `route`, `resourceType`...).
 *
 * Non vérifié en conditions réelles dans cet environnement : aucun
 * `SENTRY_DSN` de développement disponible (même limite que
 * `ANTHROPIC_API_KEY` pour l'IA, cf. TODO T3.1/T3.2, et les identifiants
 * AWS pour `storage/s3.ts`, cf. T2.5). Le chemin sans Sentry (log
 * structuré seul) est, lui, exercé par construction à chaque appel.
 */
import * as Sentry from '@sentry/node';
import { logger } from './logger';

let sentryInitialized = false;

function ensureSentryInitialized(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  if (!sentryInitialized) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
    sentryInitialized = true;
  }
  return true;
}

export interface ErrorContext {
  tenantId?: string;
  userId?: string;
  route?: string;
  resourceType?: string;
  resourceId?: string;
  [key: string]: string | undefined;
}

/**
 * Capture une erreur applicative : log structuré systématique, plus
 * envoi à Sentry si configuré. Ne relance jamais l'erreur d'origine —
 * à l'appelant de décider s'il doit encore la propager.
 */
export function captureException(error: unknown, context: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));

  logger.error({ err, ...context }, err.message);

  if (ensureSentryInitialized()) {
    Sentry.captureException(err, { extra: context });
  }
}
