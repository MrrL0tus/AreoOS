import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { date } from '@/lib/format';
import AnalyzeDocumentPanel from './AnalyzeDocumentPanel';
import ExtractionCard from './ExtractionCard';

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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default async function AiPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { extractions, documentOptions, aircraftOptions, operatorOptions } =
    await withTenant(session.tenantId, async (tx) => {
      const [extractions, documentOptions, aircraftOptions, operatorOptions] =
        await Promise.all([
          tx.aiExtraction.findMany({
            where: { deletedAt: null },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            take: 20,
            include: {
              document: { select: { title: true, category: true } },
              validatedBy: { select: { firstName: true, lastName: true } },
            },
          }),
          tx.document.findMany({
            where: { deletedAt: null, category: 'CONTRACT', extractedText: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true },
          }),
          tx.aircraft.findMany({
            where: { deletedAt: null },
            orderBy: { msn: 'asc' },
            select: { id: true, msn: true },
          }),
          tx.operator.findMany({
            where: { deletedAt: null, isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, sanctionsStatus: true },
          }),
        ]);
      return { extractions, documentOptions, aircraftOptions, operatorOptions };
    });

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
        <AnalyzeDocumentPanel documentOptions={documentOptions} />
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
            <div className="empty">Aucune extraction.</div>
          </div>
        ) : (
          extractions.map((e) => {
            const fields = (e.extractedFields ?? {}) as Record<string, ExtractedField>;

            if (e.status === 'PENDING') {
              const msn = typeof fields.msn?.value === 'string' ? fields.msn.value : '';
              const lesseeName =
                typeof fields.lesseeName?.value === 'string' ? fields.lesseeName.value : '';
              const matchedAircraft = msn
                ? aircraftOptions.find((a) => normalize(a.msn) === normalize(msn))
                : undefined;
              const matchedOperator = lesseeName
                ? operatorOptions.find((o) => normalize(o.name) === normalize(lesseeName))
                : undefined;

              return (
                <ExtractionCard
                  key={e.id}
                  extractionId={e.id}
                  documentTitle={e.document.title}
                  modelLabel={`${e.modelName}${e.modelVersion ? ` · ${e.modelVersion}` : ''}`}
                  createdAt={e.createdAt}
                  overallConfidence={e.overallConfidence}
                  fields={fields}
                  aircraftOptions={aircraftOptions}
                  operatorOptions={operatorOptions}
                  initialAircraftId={matchedAircraft?.id ?? ''}
                  initialLesseeId={matchedOperator?.id ?? ''}
                />
              );
            }

            const st = STATUS_LABELS[e.status] ?? { label: e.status, tone: 'gray' };
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

                {e.validatedBy && (
                  <div style={{ marginTop: 12, fontSize: 10.5, color: 'var(--text-3)' }}>
                    {e.status === 'REJECTED' ? 'Rejetée' : 'Validée'} par{' '}
                    {e.validatedBy.firstName} {e.validatedBy.lastName}
                    {e.validatedAt ? ` le ${date(e.validatedAt)}` : ''}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
