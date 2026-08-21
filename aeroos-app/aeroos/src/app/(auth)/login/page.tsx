'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Connexion impossible');
        setLoading(false);
        return;
      }

      router.push(params.get('from') ?? '/portfolio');
      router.refresh();
    } catch {
      setError('Erreur réseau — vérifiez que le serveur est démarré');
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ marginBottom: 26 }}>
          <div className="logo-mark" style={{ fontSize: 26 }}>
            Aero<span>OS</span>
          </div>
          <div className="logo-sub" style={{ marginTop: 4 }}>
            Asset Management Platform
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Adresse e-mail</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: 10, marginTop: 6 }}
            disabled={loading}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <div
          style={{
            marginTop: 22,
            paddingTop: 16,
            borderTop: '1px solid var(--border-2)',
            fontSize: 11,
            color: 'var(--text-3)',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'var(--text-2)' }}>Environnement de démonstration</strong>
          <br />
          admin@meridian-aviation.com
          <br />
          Mot de passe : voir <span className="mono">prisma/seed.ts</span>
        </div>
      </div>
    </div>
  );
}
