'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentCategory } from '@prisma/client';

const CATEGORY_LABELS: Record<string, string> = {
  CERTIFICATE: 'Certificat',
  CONTRACT: 'Contrat',
  MAINTENANCE: 'Maintenance',
  INSPECTION: 'Inspection',
  FINANCIAL: 'Financier',
  OTHER: 'Autre',
};

export default function UploadPanel({
  aircraftOptions,
}: {
  aircraftOptions: { id: string; msn: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Échec du dépôt');
        setLoading(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        ↑ Déposer
      </button>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Déposer un document</div>
      {error && <div className="error-box">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="file">Fichier (pdf, jpg, png, docx, xlsx — 50 Mo max)</label>
          <input id="file" name="file" type="file" required />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="title">Titre</label>
            <input id="title" name="title" className="input" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="aircraftId">Actif</label>
            <select id="aircraftId" name="aircraftId" required defaultValue="">
              <option value="" disabled>Sélectionner un actif…</option>
              {aircraftOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.msn}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="category">Catégorie</label>
            <select id="category" name="category" required defaultValue="">
              <option value="" disabled>Sélectionner…</option>
              {Object.values(DocumentCategory).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="subcategory">Sous-catégorie</label>
            <input id="subcategory" name="subcategory" className="input" type="text" placeholder="CofA, Lease Agreement…" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="issueDate">Date d&apos;émission</label>
            <input id="issueDate" name="issueDate" className="input" type="date" />
          </div>
          <div className="field">
            <label htmlFor="expiryDate">Date d&apos;expiration</label>
            <input id="expiryDate" name="expiryDate" className="input" type="date" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Dépôt en cours…' : 'Déposer'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
