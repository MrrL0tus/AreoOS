'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AnalyzeDocumentPanel({
  documentOptions,
}: {
  documentOptions: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [documentId, setDocumentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'extraction");
        setLoading(false);
        return;
      }
      setOpen(false);
      setDocumentId('');
      router.refresh();
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        disabled={documentOptions.length === 0}
        title={documentOptions.length === 0 ? 'Aucun contrat PDF avec texte extrait disponible' : undefined}
      >
        Analyser un document
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {error && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</span>}
      <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} style={{ minWidth: 220 }}>
        <option value="" disabled>Sélectionner un contrat…</option>
        {documentOptions.map((d) => (
          <option key={d.id} value={d.id}>{d.title}</option>
        ))}
      </select>
      <button className="btn btn-primary" onClick={handleAnalyze} disabled={!documentId || loading}>
        {loading ? 'Analyse en cours…' : 'Lancer'}
      </button>
      <button className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
    </div>
  );
}
