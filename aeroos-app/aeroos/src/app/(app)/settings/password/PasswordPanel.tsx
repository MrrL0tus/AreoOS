'use client';

import { useState } from 'react';

export default function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Impossible de changer le mot de passe');
        setLoading(false);
        return;
      }
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Changer le mot de passe</div>

      {error && <div className="error-box">{error}</div>}
      {success && (
        <div className="success-box">
          Mot de passe modifié. Vos autres sessions actives ont été
          déconnectées.
        </div>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
        Minimum 12 caractères, au moins 3 catégories parmi majuscules,
        minuscules, chiffres et symboles.
      </p>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="current-password">Mot de passe actuel</label>
          <input
            id="current-password"
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">Nouveau mot de passe</label>
          <input
            id="new-password"
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={12}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirmer le nouveau mot de passe</label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            minLength={12}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Modification…' : 'Changer le mot de passe'}
        </button>
      </form>
    </div>
  );
}
