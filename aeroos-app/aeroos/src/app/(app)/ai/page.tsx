import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'À valider', tone: 'amber' },
  VALIDATED: { label: 'Validée', tone: 'green' },
  REJECTED: { label: 'Rejetée', tone: 'red' },
  PARTIAL: { label: 'Partielle', tone: 'blue' },
};

interface ExtractedField {
  value?: unknown;
  confidence?: number;
  sourcePage?: number;
}

export default async function AiPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const extractions = await withTenant(session.tenantId, (tx) =>
    tx.aiExtraction.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 20,
      include: {
        document: { select: { title: true, category: true } },
        validatedBy: { select: { firstName: true, lastName: true } },
      },
    })
  );

  const pending = extractions.filter((e) => e.status === 'PENDING');

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Intelligence IA</div>
          <div className="topbar-sub">
            {pending.length} extraction(s) en attente de validation humaine
          </div>
        </div>
        <button className="btn btn-primary">Analyser un document</button>
      </div>

      <div className="content">
        <div className="disclaimer">
          <strong>L&apos;IA assiste, l&apos;humain valide.</strong> Aucune donnée
          extraite automatiquement n&apos;est enregistrée sans confirmation
          explicite. Tout champ dont la confiance est inférieure à 85 % est
          marqué pour vérification manuelle. Chaque extraction est tracée
          (modèle, version, date, validateur).
        </div>

        {extractions.length === 0 ? (
          <div className="card">
            <div className="empty">
              Aucune extraction.
              <br />
              <span style={{ fontSize: 11.5 }}>
                Le pipeline d&apos;extraction reste à implémenter — voir README
                §Prochaines étapes.
              </span>
            </div>
          </div>
        ) : (
          extractions.map((e) => {
            const st = STATUS_LABELS[e.status] ?? {
              label: e.status,
              tone: 'gray',
            };
            const fields = (e.extractedFields ?? {}) as Record<
              string,
              ExtractedField
            >;
            const entries = Object.entries(fields).slice(0, 8);

            return (
              <div key={e.id} className="card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 14,
                    paddingBottom: 10,
                    borderBottom: '1px solid var(--border-2)',
                  }}
                >
                  <span className="badge badge-purple">◉ IA</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {e.document.title}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                      {e.modelName}
                      {e.modelVersion ? ` · ${e.modelVersion}` : ''} ·{' '}
                      {date(e.createdAt)} · confiance globale{' '}
                      {Math.round(e.overallConfidence * 100)} %
                    </div>
                  </div>
                  <span className={`badge badge-${st.tone}`}>{st.label}</span>
                </div>

                {entries.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                    Aucun champ extrait.
                  </div>
                ) : (
                  entries.map(([key, field]) => {
                    const conf = field?.confidence ?? 0;
                    const low = conf < 0.85;
                    return (
                      <div key={key} className="row-detail">
                        <span className="row-label">{key}</span>
                        <span className="row-value">
                          <span style={{ marginRight: 10 }}>
                            {String(field?.value ?? '—')}
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10.5,
                              color: low ? 'var(--amber)' : 'var(--green)',
                            }}
                          >
                            {Math.round(conf * 100)} %
                            {low && ' · à vérifier'}
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}

                {e.status === 'PENDING' ? (
                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button className="btn btn-primary">
                      ✓ Valider et enregistrer
                    </button>
                    <button className="btn btn-ghost">Corriger</button>
                    <button
                      className="btn btn-ghost"
                      style={{ color: 'var(--red)' }}
                    >
                      Rejeter
                    </button>
                  </div>
                ) : (
                  e.validatedBy && (
                    <div
                      style={{
                        marginTop: 12,
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                      }}
                    >
                      Validée par {e.validatedBy.firstName}{' '}
                      {e.validatedBy.lastName}
                      {e.validatedAt ? ` le ${date(e.validatedAt)}` : ''}
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
