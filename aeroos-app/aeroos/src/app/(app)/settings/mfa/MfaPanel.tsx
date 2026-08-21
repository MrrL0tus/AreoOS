'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'status' | 'scan' | 'recovery-codes';

interface SetupData {
  otpauthUrl: string;
  secret: string;
  qrCodeDataUrl: string;
}

export default function MfaPanel({
  initialEnabled,
  remainingRecoveryCodes,
}: {
  initialEnabled: boolean;
  remainingRecoveryCodes: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<Step>('status');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Impossible de démarrer l’activation');
        setLoading(false);
        return;
      }
      setSetupData(data);
      setStep('scan');
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Code invalide');
        setLoading(false);
        return;
      }
      setRecoveryCodes(data.recoveryCodes);
      setEnabled(true);
      setStep('recovery-codes');
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'recovery-codes') {
    return (
      <div className="card">
        <div className="card-title">MFA activé — codes de récupération</div>
        <div className="disclaimer" style={{ marginBottom: 14, marginTop: 0 }}>
          Notez ces 8 codes dans un endroit sûr. Chacun ne fonctionne qu&apos;une
          seule fois et permet de vous connecter si vous perdez l&apos;accès à
          votre application d&apos;authentification. Ils ne seront plus jamais
          affichés.
        </div>
        <div
          className="mono"
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 14, fontSize: 13, marginBottom: 16,
          }}
        >
          {recoveryCodes.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => router.refresh()}
        >
          J&apos;ai sauvegardé mes codes
        </button>
      </div>
    );
  }

  if (step === 'scan' && setupData) {
    return (
      <div className="card">
        <div className="card-title">Scanner le QR code</div>
        {error && <div className="error-box">{error}</div>}
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
          Scannez ce code avec votre application d&apos;authentification
          (Google Authenticator, 1Password, Authy…), puis saisissez le code à
          6 chiffres généré pour confirmer l&apos;activation.
        </p>
        <img
          src={setupData.qrCodeDataUrl}
          alt="QR code d'activation MFA"
          width={200}
          height={200}
          style={{ borderRadius: 8, marginBottom: 12 }}
        />
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 4 }}>
            SAISIE MANUELLE
          </div>
          <div className="mono" style={{ fontSize: 12.5 }}>{setupData.secret}</div>
        </div>

        <form onSubmit={confirmSetup}>
          <div className="field">
            <label htmlFor="mfa-code">Code de confirmation</label>
            <input
              id="mfa-code"
              className="input"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Vérification…' : 'Confirmer et activer'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={() => {
              setStep('status');
              setSetupData(null);
              setCode('');
              setError(null);
            }}
          >
            Annuler
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Authentification à deux facteurs (TOTP)</div>
      {error && <div className="error-box">{error}</div>}
      {enabled ? (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 6 }}>
            Le MFA est actif sur ce compte. Un code sera demandé à chaque
            connexion, en plus du mot de passe.
          </p>
          <p style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            {remainingRecoveryCodes} code(s) de récupération restant(s).
          </p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
            Le MFA n&apos;est pas encore activé. Le cahier de conformité (§2.2)
            l&apos;exige avant l&apos;ouverture des accès beta.
          </p>
          <button className="btn btn-primary" onClick={startSetup} disabled={loading}>
            {loading ? 'Génération…' : 'Activer le MFA'}
          </button>
        </>
      )}
    </div>
  );
}
