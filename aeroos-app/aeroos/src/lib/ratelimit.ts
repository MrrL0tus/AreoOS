/**
 * AeroOS — Limitation de débit sur la connexion
 * ═══════════════════════════════════════════════════════════════════
 *
 * Implémentation en mémoire (Map + fenêtre glissante) : suffisante pour
 * une seule instance. ⚠️ En production multi-instance, remplacer par un
 * backend partagé (Redis) — chaque instance a sinon ses propres
 * compteurs, ce qui multiplie le nombre d'essais réellement autorisés
 * par le nombre d'instances. Ne pas sur-concevoir avant ce besoin réel.
 */

interface Bucket {
  failures: number[];
  blockedUntil?: number;
}

const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_BLOCK_MS = 15 * 60 * 1000;

const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;
const IP_BLOCK_MS = 60 * 60 * 1000;

const emailBuckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

function prune(bucket: Bucket, windowMs: number, now: number): void {
  bucket.failures = bucket.failures.filter((t) => now - t < windowMs);
}

function blockedSecondsLeft(bucket: Bucket | undefined, now: number): number | null {
  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    return Math.ceil((bucket.blockedUntil - now) / 1000);
  }
  return null;
}

function bump(
  buckets: Map<string, Bucket>,
  key: string,
  windowMs: number,
  maxAttempts: number,
  blockMs: number,
  now: number
): void {
  const bucket = buckets.get(key) ?? { failures: [] };
  prune(bucket, windowMs, now);
  bucket.failures.push(now);
  if (bucket.failures.length >= maxAttempts) {
    bucket.blockedUntil = now + blockMs;
    bucket.failures = [];
  }
  buckets.set(key, bucket);
}

export interface LoginRateLimitStatus {
  blocked: boolean;
  retryAfterSeconds?: number;
}

/**
 * À appeler avant de traiter une tentative de connexion.
 */
export function checkLoginRateLimit(email: string, ip: string): LoginRateLimitStatus {
  const now = Date.now();
  const emailRetry = blockedSecondsLeft(emailBuckets.get(email), now);
  const ipRetry = blockedSecondsLeft(ipBuckets.get(ip), now);

  if (emailRetry === null && ipRetry === null) {
    return { blocked: false };
  }
  return {
    blocked: true,
    retryAfterSeconds: Math.max(emailRetry ?? 0, ipRetry ?? 0),
  };
}

/**
 * À appeler après un échec de connexion (mot de passe invalide, y
 * compris pour un e-mail qui n'existe pas — le comptage ne doit pas
 * révéler l'existence d'un compte).
 */
export function recordFailedLogin(email: string, ip: string): void {
  const now = Date.now();
  bump(emailBuckets, email, EMAIL_WINDOW_MS, EMAIL_MAX_ATTEMPTS, EMAIL_BLOCK_MS, now);
  bump(ipBuckets, ip, IP_WINDOW_MS, IP_MAX_ATTEMPTS, IP_BLOCK_MS, now);
}

/**
 * À appeler dès que le mot de passe est validé (avant même le MFA) :
 * une connexion réussie remet le compteur à zéro.
 */
export function resetLoginRateLimit(email: string, ip: string): void {
  emailBuckets.delete(email);
  ipBuckets.delete(ip);
}
