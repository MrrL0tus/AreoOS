import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit } from './ratelimit';

// L'état est un Map au niveau module — chaque test utilise un e-mail/IP
// unique pour rester indépendant des autres, plutôt que de réinitialiser
// le module (pas de hook d'export prévu pour ça, et ce n'est pas son rôle).
let counter = 0;
function uniqueEmail() {
  return `qa-ratelimit-${counter++}@example.invalid`;
}
function uniqueIp() {
  return `10.0.0.${counter++}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkLoginRateLimit / recordFailedLogin', () => {
  it('autorise tant que le nombre d\'échecs est sous le seuil', () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    for (let i = 0; i < 4; i++) recordFailedLogin(email, ip);
    expect(checkLoginRateLimit(email, ip).blocked).toBe(false);
  });

  it('bloque après 5 échecs sur le même e-mail (15 min)', () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) recordFailedLogin(email, ip);
    const status = checkLoginRateLimit(email, ip);
    expect(status.blocked).toBe(true);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(status.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('bloque un e-mail différent mais partageant la même IP après 20 échecs', () => {
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) recordFailedLogin(uniqueEmail(), ip);
    const status = checkLoginRateLimit(uniqueEmail(), ip);
    expect(status.blocked).toBe(true);
    // Blocage IP : 1h, distinct du blocage e-mail (15 min)
    expect(status.retryAfterSeconds).toBeGreaterThan(15 * 60);
  });

  it('une connexion réussie (resetLoginRateLimit) remet le compteur à zéro', () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) recordFailedLogin(email, ip);
    expect(checkLoginRateLimit(email, ip).blocked).toBe(true);

    resetLoginRateLimit(email, ip);
    expect(checkLoginRateLimit(email, ip).blocked).toBe(false);
  });

  it('le blocage se lève après expiration de la fenêtre de blocage', () => {
    vi.useFakeTimers();
    const email = uniqueEmail();
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) recordFailedLogin(email, ip);
    expect(checkLoginRateLimit(email, ip).blocked).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    expect(checkLoginRateLimit(email, ip).blocked).toBe(false);
  });

  it('des échecs anciens (hors fenêtre glissante) ne comptent plus', () => {
    vi.useFakeTimers();
    const email = uniqueEmail();
    const ip = uniqueIp();
    for (let i = 0; i < 4; i++) recordFailedLogin(email, ip);

    vi.advanceTimersByTime(16 * 60 * 1000); // hors fenêtre de 15 min
    recordFailedLogin(email, ip); // un seul échec "récent" au lieu de 5
    expect(checkLoginRateLimit(email, ip).blocked).toBe(false);
  });
});
