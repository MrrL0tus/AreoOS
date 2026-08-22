'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const CHECK_INTERVAL_MS = 60_000;
const ACTIVITY_WINDOW_MS = 3 * 60_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'] as const;

/**
 * Maintient la session active tant que l'utilisateur interagit avec la
 * page (renouvellement de la fenêtre glissante côté serveur — cf. T1.4).
 * Sans activité récente, aucun ping n'est envoyé et le cookie expire
 * naturellement à sa date d'échéance.
 */
export default function SessionRenewer() {
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActive, { passive: true })
    );

    const interval = setInterval(async () => {
      if (Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS) return;

      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        if (res.status === 401) {
          router.push('/login');
        }
      } catch {
        // Erreur réseau ponctuelle : on retente au prochain intervalle,
        // le cookie existant reste valide jusqu'à son échéance naturelle.
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, markActive)
      );
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
