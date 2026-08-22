/**
 * AeroOS — Journalisation structurée (T5.3)
 * ═══════════════════════════════════════════════════════════════════
 *
 * JSON en production (exploitable par un agrégateur de logs), lisible
 * en développement (pino-pretty). `redact` est un filet de sécurité
 * défensif — les points d'appel ne doivent JAMAIS passer d'e-mail, de
 * mot de passe ou de contenu de contrat (cf. CLAUDE.md règle 6 / cahier
 * de conformité §7 D4) : identifier une personne par `userId`/`tenantId`
 * uniquement, jamais par son e-mail.
 */
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
// pino-pretty tourne dans un worker thread : à éviter en test (surcoût
// de démarrage par fichier, sans bénéfice — JSON brut suffit à vérifier
// la structure des logs).
const usePretty = !isProd && process.env.NODE_ENV !== 'test';

export const REDACT_PATHS = [
  'email', '*.email', '*.*.email',
  'password', '*.password',
  'passwordHash', '*.passwordHash',
  'mfaSecret', '*.mfaSecret',
  'mfaRecoveryCodes', '*.mfaRecoveryCodes',
  'token', '*.token', 'authorization',
  'req.headers.cookie',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
