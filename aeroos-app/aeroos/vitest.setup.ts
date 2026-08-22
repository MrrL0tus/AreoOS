import { vi } from 'vitest';

/**
 * `next/headers`'s `cookies()` ne fonctionne que dans une requête Next.js
 * réelle. Pour tester `src/lib/auth.ts` (qui l'utilise pour poser/lire le
 * cookie de session) hors du runtime Next, on le remplace par un jar en
 * mémoire au même contrat (`get`/`set`/`delete`, tous async comme en
 * Next.js 15). Réinitialisé entre chaque fichier de test.
 */
interface FakeCookie {
  value: string;
}

class FakeCookieStore {
  private jar = new Map<string, FakeCookie>();

  get(name: string): FakeCookie | undefined {
    return this.jar.get(name);
  }

  set(name: string, value: string, _opts?: unknown): void {
    this.jar.set(name, { value });
  }

  delete(name: string): void {
    this.jar.delete(name);
  }

  clear(): void {
    this.jar.clear();
  }
}

export const fakeCookieStore = new FakeCookieStore();

vi.mock('next/headers', () => ({
  cookies: async () => fakeCookieStore,
}));
