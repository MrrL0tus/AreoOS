'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitSummaryFeedback } from '@/lib/actions/ai-summary-feedback';
import { money } from '@/lib/format';

export interface ReportSummaryData {
  overallResult: string;
  engineCondition: { engine: string; egtMargin: string | null; llpCyclesRemaining: number | null }[];
  adCompleted: number | null;
  adRemaining: number | null;
  costBreakdown: { category: string; amount: number | null }[];
  totalCost: number | null;
  currency: string | null;
  nextMilestoneDescription: string | null;
  nextMilestoneEstimatedDate: string | null;
}

export default function SummaryPanel({
  documentId,
  canGenerate,
  canRegenerate,
  hasExtractedText,
  aiSummary,
  aiSummaryData,
  aiSummaryModel,
  aiSummaryFeedback,
}: {
  documentId: string;
  canGenerate: boolean;
  canRegenerate: boolean;
  hasExtractedText: boolean;
  aiSummary: string | null;
  aiSummaryData: ReportSummaryData | null;
  aiSummaryModel: string | null;
  aiSummaryFeedback: boolean | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackPending, startFeedbackTransition] = useTransition();
  const [feedback, setFeedback] = useState(aiSummaryFeedback);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Échec du résumé');
        setLoading(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  function giveFeedback(useful: boolean) {
    startFeedbackTransition(async () => {
      const result = await submitSummaryFeedback(documentId, useful);
      if (result.ok) setFeedback(useful);
    });
  }

  if (!aiSummary || !aiSummaryData) {
    return (
      <div className="card">
        <div className="card-title">Résumé IA</div>
        {error && <div className="error-box">{error}</div>}
        {!hasExtractedText ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            Aucun texte extrait pour ce document — le résumé nécessite un PDF lisible.
          </div>
        ) : canGenerate ? (
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? 'Génération en cours…' : 'Générer un résumé IA'}
          </button>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            Rôle insuffisant pour générer un résumé (ANALYST minimum requis).
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">
        Résumé IA
        {canRegenerate && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11 }}
            onClick={generate}
            disabled={loading}
          >
            {loading ? 'Régénération…' : '↻ Régénérer'}
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}

      <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>
        {aiSummary}
      </p>

      {aiSummaryData.engineCondition.length > 0 && (
        <>
          <div className="section-title" style={{ marginBottom: 8 }}>État moteurs</div>
          {aiSummaryData.engineCondition.map((e, i) => (
            <div key={i} className="row-detail">
              <span className="row-label">{e.engine}</span>
              <span className="row-value" style={{ fontSize: 11.5 }}>
                {e.egtMargin ? `EGT margin ${e.egtMargin}` : ''}
                {e.egtMargin && e.llpCyclesRemaining != null ? ' · ' : ''}
                {e.llpCyclesRemaining != null ? `${e.llpCyclesRemaining} cycles LLP restants` : ''}
                {!e.egtMargin && e.llpCyclesRemaining == null ? '—' : ''}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="row-detail">
        <span className="row-label">Airworthiness Directives</span>
        <span className="row-value" style={{ fontSize: 11.5 }}>
          {aiSummaryData.adCompleted ?? '—'} traitées / {aiSummaryData.adRemaining ?? '—'} restantes
        </span>
      </div>

      {aiSummaryData.costBreakdown.length > 0 && (
        <>
          <div className="section-title" style={{ margin: '12px 0 8px' }}>Coûts</div>
          {aiSummaryData.costBreakdown.map((c, i) => (
            <div key={i} className="row-detail">
              <span className="row-label">{c.category}</span>
              <span className="row-value mono" style={{ fontSize: 11.5 }}>
                {c.amount != null ? money(c.amount, aiSummaryData.currency ?? 'USD') : '—'}
              </span>
            </div>
          ))}
        </>
      )}
      {aiSummaryData.totalCost != null && (
        <div className="row-detail">
          <span className="row-label">Coût total</span>
          <span className="row-value mono">
            {money(aiSummaryData.totalCost, aiSummaryData.currency ?? 'USD')}
          </span>
        </div>
      )}

      <div className="row-detail">
        <span className="row-label">Prochaine échéance</span>
        <span className="row-value" style={{ fontSize: 11.5 }}>
          {aiSummaryData.nextMilestoneDescription ?? '—'}
          {aiSummaryData.nextMilestoneEstimatedDate ? ` (${aiSummaryData.nextMilestoneEstimatedDate})` : ''}
        </span>
      </div>

      <div className="disclaimer">
        Toute donnée chiffrée ci-dessus est une estimation issue d&apos;un résumé
        automatique{aiSummaryModel ? ` (${aiSummaryModel})` : ''} — non certifiée,
        ne peut alimenter aucun calcul réglementaire.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Ce résumé est-il utile ?</span>
        <button
          className="btn btn-ghost"
          style={{ color: feedback === true ? 'var(--green)' : undefined }}
          onClick={() => giveFeedback(true)}
          disabled={feedbackPending}
        >
          👍 Utile
        </button>
        <button
          className="btn btn-ghost"
          style={{ color: feedback === false ? 'var(--red)' : undefined }}
          onClick={() => giveFeedback(false)}
          disabled={feedbackPending}
        >
          👎 Pas utile
        </button>
      </div>
    </div>
  );
}
