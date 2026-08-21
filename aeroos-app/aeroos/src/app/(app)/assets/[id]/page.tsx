import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { withTenant, audit } from '@/lib/db';
import {
  money,
  moneyCompact,
  num,
  date,
  daysUntil,
  aircraftLabel,
  assetStatus,
} from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ENGINE_POSITION_LABELS: Record<string, string> = {
  LEFT: 'Gauche',
  RIGHT: 'Droit',
  TAIL: 'Queue',
  SPARE: 'Spare',
};

const EVENT_LABELS: Record<string, string> = {
  DELIVERY: 'Livraison',
  OPERATOR_CHANGE: "Changement d'opérateur",
  MAINTENANCE_VISIT: 'Visite de maintenance',
  INCIDENT: 'Incident',
  STORAGE_IN: 'Mise en stockage',
  STORAGE_OUT: 'Sortie de stockage',
  OWNERSHIP_CHANGE: 'Changement de propriétaire',
  MODIFICATION: 'Modification',
  INSPECTION: 'Inspection',
  OTHER: 'Autre',
};

const QUALITY_LABELS: Record<string, { label: string; tone: string }> = {
  CERTIFIED: { label: 'Certifiée', tone: 'green' },
  DECLARED: { label: 'Déclarée', tone: 'blue' },
  ESTIMATED: { label: 'Estimée', tone: 'amber' },
};

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/login');

  const aircraft = await withTenant(session.tenantId, (tx) =>
    tx.aircraft.findFirst({
      where: { id, deletedAt: null },
      include: {
        currentOperator: true,
        portfolio: { select: { name: true } },
        engines: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
        components: {
          where: { deletedAt: null },
          orderBy: { nextOverhaulDue: 'asc' },
        },
        contracts: {
          where: { deletedAt: null },
          orderBy: { startDate: 'desc' },
          include: { lessee: { select: { name: true } } },
        },
        valuations: {
          orderBy: { valuationDate: 'desc' },
          take: 6,
        },
        maintenance: {
          where: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          orderBy: { dueDate: 'asc' },
          take: 5,
        },
        events: {
          orderBy: { eventDate: 'desc' },
          take: 10,
          include: { operator: { select: { name: true } } },
        },
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 6,
        },
      },
    })
  );

  if (!aircraft) notFound();

  // Traçabilité de la consultation — cf. Cahier de conformité §7 D3
  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'VIEW',
    resourceType: 'Aircraft',
    resourceId: aircraft.id,
  });

  const status = assetStatus(aircraft.status);
  const activeContract = aircraft.contracts.find(
    (c) => c.status === 'ACTIVE' || c.status === 'EXPIRING'
  );
  const latestVal = aircraft.valuations[0];
  const quality = QUALITY_LABELS[aircraft.hoursQuality] ?? QUALITY_LABELS.DECLARED;

  const cofaDays = daysUntil(aircraft.cofaExpiryDate);
  const insDays = daysUntil(aircraft.insuranceExpiryDate);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">
            <Link href="/assets" style={{ color: 'var(--text-3)' }}>
              Actifs
            </Link>
            <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>/</span>
            <span className="mono">{aircraft.msn}</span>
          </div>
          <div className="topbar-sub">
            {aircraftLabel(aircraft)} · {aircraft.registration ?? 'sans immat.'}
          </div>
        </div>
        <span className={`badge badge-${status.tone}`} style={{ fontSize: 12, padding: '4px 12px' }}>
          {status.label}
        </span>
      </div>

      <div className="content">
        {/* ── Synthèse ── */}
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">Heures de vol</div>
            <div className="kpi-value">{num(aircraft.totalHours)}</div>
            <div className="kpi-sub">
              <span className={`badge badge-${quality.tone}`} style={{ fontSize: 9 }}>
                {quality.label}
              </span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Cycles</div>
            <div className="kpi-value">{num(aircraft.totalCycles)}</div>
            <div className="kpi-sub">
              {aircraft.lastUtilizationUpdate
                ? `MàJ ${date(aircraft.lastUtilizationUpdate)}`
                : 'Date de MàJ inconnue'}
            </div>
          </div>
          <div className="kpi teal">
            <div className="kpi-label">Base Value</div>
            <div className="kpi-value">
              {latestVal
                ? moneyCompact(Number(latestVal.baseValue), latestVal.currency)
                : '—'}
            </div>
            <div className="kpi-sub">
              {latestVal ? date(latestVal.valuationDate) : 'Non valorisé'}
            </div>
          </div>
          <div className={aircraft.openAdCount > 0 ? 'kpi amber' : 'kpi green'}>
            <div className="kpi-label">Navigabilité</div>
            <div className="kpi-value">{aircraft.openAdCount}</div>
            <div className="kpi-sub">
              AD ouvertes · {aircraft.openSbCount} SB
            </div>
          </div>
        </div>

        <div className="grid-2">
          {/* ── Identité ── */}
          <div className="card">
            <div className="card-title">Identité de l&apos;actif</div>
            <div className="row-detail">
              <span className="row-label">MSN</span>
              <span className="row-value mono">{aircraft.msn}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Immatriculation</span>
              <span className="row-value mono">
                {aircraft.registration ?? '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Constructeur / Type</span>
              <span className="row-value">{aircraftLabel(aircraft)}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Année de construction</span>
              <span className="row-value">{aircraft.yearBuilt}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Configuration cabine</span>
              <span className="row-value">
                {aircraft.cabinConfig ?? '—'}
                {aircraft.seatCount ? ` (${aircraft.seatCount} sièges)` : ''}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MTOW</span>
              <span className="row-value mono">
                {aircraft.mtowKg ? `${num(aircraft.mtowKg)} kg` : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Portefeuille</span>
              <span className="row-value">
                {aircraft.portfolio?.name ?? '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Opérateur actuel</span>
              <span className="row-value" style={{ color: 'var(--blue)' }}>
                {aircraft.currentOperator?.name ?? '—'}
              </span>
            </div>
          </div>

          {/* ── Navigabilité & moteurs ── */}
          <div className="card">
            <div className="card-title">État technique</div>

            {aircraft.engines.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 12 }}>
                Aucun moteur rattaché.
              </div>
            ) : (
              aircraft.engines.map((e) => (
                <div key={e.id} className="row-detail">
                  <span className="row-label">
                    Moteur {ENGINE_POSITION_LABELS[e.position ?? 'SPARE']}
                  </span>
                  <span className="row-value mono" style={{ fontSize: 11.5 }}>
                    {e.model} · SN {e.serialNumber}
                  </span>
                </div>
              ))
            )}

            {aircraft.components.slice(0, 3).map((c) => (
              <div key={c.id} className="row-detail">
                <span className="row-label">{c.type.replace(/_/g, ' ')}</span>
                <span className="row-value" style={{ fontSize: 11.5 }}>
                  {c.nextOverhaulDue
                    ? `Overhaul ${date(c.nextOverhaulDue)}`
                    : (c.serialNumber ?? '—')}
                </span>
              </div>
            ))}

            <div className="row-detail">
              <span className="row-label">CofA</span>
              <span
                className="row-value"
                style={{
                  color:
                    cofaDays !== null && cofaDays < 90
                      ? 'var(--amber)'
                      : 'var(--text)',
                }}
              >
                {aircraft.cofaExpiryDate
                  ? `${date(aircraft.cofaExpiryDate)}${cofaDays !== null ? ` (${cofaDays} j)` : ''}`
                  : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Assurance</span>
              <span
                className="row-value"
                style={{
                  color:
                    insDays !== null && insDays < 60
                      ? 'var(--amber)'
                      : 'var(--text)',
                }}
              >
                {aircraft.insuranceExpiryDate
                  ? `${date(aircraft.insuranceExpiryDate)}${insDays !== null ? ` (${insDays} j)` : ''}`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Contrat actif ── */}
        {activeContract && (
          <div className="card">
            <div className="card-title">Contrat en cours</div>
            <div className="grid-2" style={{ marginBottom: 0 }}>
              <div>
                <div className="row-detail">
                  <span className="row-label">Référence</span>
                  <span className="row-value mono">
                    {activeContract.reference}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">Locataire</span>
                  <span className="row-value">
                    {activeContract.lessee.name}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">Période</span>
                  <span className="row-value" style={{ fontSize: 11.5 }}>
                    {date(activeContract.startDate)} →{' '}
                    {date(activeContract.endDate)}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">Droit applicable</span>
                  <span className="row-value">
                    {activeContract.governingLaw ?? '—'}
                  </span>
                </div>
              </div>
              <div>
                <div className="row-detail">
                  <span className="row-label">Loyer mensuel</span>
                  <span
                    className="row-value mono"
                    style={{ color: 'var(--green)' }}
                  >
                    {money(
                      Number(activeContract.monthlyRent),
                      activeContract.currency
                    )}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">Indexation</span>
                  <span className="row-value mono" style={{ fontSize: 11.5 }}>
                    {activeContract.escalationClause ?? '—'}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">Dépôt de garantie</span>
                  <span className="row-value mono">
                    {activeContract.securityDeposit
                      ? money(
                          Number(activeContract.securityDeposit),
                          activeContract.currency
                        )
                      : '—'}
                  </span>
                </div>
                <div className="row-detail">
                  <span className="row-label">MR moteurs / mois</span>
                  <span className="row-value mono">
                    {money(
                      Number(activeContract.mrEngineLeft ?? 0) +
                        Number(activeContract.mrEngineRight ?? 0),
                      activeContract.currency
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid-2">
          {/* ── Historique ── */}
          <div className="card">
            <div className="card-title">Historique de l&apos;actif</div>
            {aircraft.events.length === 0 ? (
              <div className="empty">Aucun événement enregistré.</div>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 18 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 6,
                    bottom: 6,
                    width: 1,
                    background: 'var(--border)',
                  }}
                />
                {aircraft.events.map((e) => (
                  <div
                    key={e.id}
                    style={{ position: 'relative', marginBottom: 14 }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: -18,
                        top: 3,
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background:
                          e.eventType === 'INCIDENT'
                            ? 'var(--red)'
                            : 'var(--blue)',
                        border: '2px solid var(--surface)',
                      }}
                    />
                    <div
                      className="mono"
                      style={{ fontSize: 10, color: 'var(--text-3)' }}
                    >
                      {date(e.eventDate)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {e.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                        marginTop: 1,
                      }}
                    >
                      {EVENT_LABELS[e.eventType] ?? e.eventType}
                      {e.operator ? ` · ${e.operator.name}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Maintenance + valorisation ── */}
          <div>
            <div className="card">
              <div className="card-title">Maintenance planifiée</div>
              {aircraft.maintenance.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  Aucune tâche planifiée.
                </div>
              ) : (
                aircraft.maintenance.map((m) => (
                  <div key={m.id} className="row-detail">
                    <span className="row-label">
                      {m.type.replace(/_/g, ' ')}
                      {m.mroName ? ` · ${m.mroName}` : ''}
                    </span>
                    <span className="row-value" style={{ fontSize: 11.5 }}>
                      {date(m.dueDate)}
                      {m.estimatedCost
                        ? ` · ${moneyCompact(Number(m.estimatedCost), m.currency)}`
                        : ''}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <div className="card-title">Historique de valorisation</div>
              {aircraft.valuations.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  Aucune valorisation enregistrée.
                </div>
              ) : (
                aircraft.valuations.map((v) => (
                  <div key={v.id} className="row-detail">
                    <span className="row-label mono" style={{ fontSize: 11.5 }}>
                      {date(v.valuationDate)}
                    </span>
                    <span className="row-value">
                      <span className="mono">
                        {moneyCompact(Number(v.baseValue), v.currency)}
                      </span>
                      <span
                        className={`badge badge-${v.isCertified ? 'green' : 'gray'}`}
                        style={{ marginLeft: 8, fontSize: 9 }}
                      >
                        {v.isCertified ? 'Certifiée' : 'Algorithmique'}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Documents ── */}
        <div className="card">
          <div className="card-title">
            Documents rattachés ({aircraft.documents.length})
          </div>
          {aircraft.documents.length === 0 ? (
            <div className="empty">Aucun document.</div>
          ) : (
            aircraft.documents.map((d) => (
              <div key={d.id} className="row-detail">
                <span className="row-label">
                  {d.title}
                  <span
                    className="badge badge-gray"
                    style={{ marginLeft: 8, fontSize: 9 }}
                  >
                    {d.category}
                  </span>
                </span>
                <span
                  className="row-value t3"
                  style={{ fontSize: 11, fontWeight: 400 }}
                >
                  {d.expiryDate ? `Expire ${date(d.expiryDate)}` : date(d.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
