import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import {
  moneyCompact,
  num,
  date,
  daysUntil,
  aircraftLabel,
  assetStatus,
} from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const aircraft = await withTenant(session.tenantId, (tx) =>
    tx.aircraft.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: 'asc' }, { msn: 'asc' }],
      select: {
        id: true,
        msn: true,
        registration: true,
        manufacturer: true,
        model: true,
        variant: true,
        yearBuilt: true,
        totalHours: true,
        totalCycles: true,
        status: true,
        currentOperator: { select: { name: true, sanctionsStatus: true } },
        engines: {
          where: { deletedAt: null },
          select: { model: true, position: true },
        },
        contracts: {
          where: { deletedAt: null, status: 'ACTIVE' },
          select: { endDate: true },
          take: 1,
        },
        valuations: {
          orderBy: { valuationDate: 'desc' },
          take: 1,
          select: { baseValue: true, currency: true },
        },
      },
    })
  );

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Registre des actifs</div>
          <div className="topbar-sub">
            {aircraft.length} appareil(s) enregistré(s)
          </div>
        </div>
        <button className="btn btn-ghost">↓ Export CSV</button>
        <Link href="/assets/import" className="btn btn-ghost">↑ Import CSV</Link>
        <Link href="/assets/new" className="btn btn-primary">+ Nouvel actif</Link>
      </div>

      <div className="content">
        {aircraft.length === 0 ? (
          <div className="card">
            <div className="empty">
              Aucun actif enregistré.
              <br />
              <span style={{ fontSize: 11.5 }}>
                Lancez <span className="mono">npm run db:seed</span> pour charger
                le jeu de démonstration.
              </span>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MSN</th>
                  <th>Type</th>
                  <th>Immat.</th>
                  <th>Moteurs</th>
                  <th>FH / FC</th>
                  <th>Locataire</th>
                  <th>Échéance</th>
                  <th>Valeur</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {aircraft.map((a) => {
                  const status = assetStatus(a.status);
                  const contract = a.contracts[0];
                  const days = contract ? daysUntil(contract.endDate) : null;
                  const val = a.valuations[0];
                  const engineModel = a.engines[0]?.model;
                  const engineCount = a.engines.filter(
                    (e) => e.position !== 'SPARE'
                  ).length;

                  return (
                    <tr key={a.id}>
                      <td>
                        <Link
                          href={`/assets/${a.id}`}
                          className="mono"
                          style={{ color: 'var(--blue)' }}
                        >
                          {a.msn}
                        </Link>
                      </td>
                      <td>
                        <strong>{aircraftLabel(a)}</strong>
                        <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                          {a.yearBuilt}
                        </div>
                      </td>
                      <td className="mono t2">{a.registration ?? '—'}</td>
                      <td className="t2" style={{ fontSize: 11.5 }}>
                        {engineModel
                          ? `${engineModel}${engineCount > 1 ? ` ×${engineCount}` : ''}`
                          : '—'}
                      </td>
                      <td className="mono t2" style={{ fontSize: 11.5 }}>
                        {num(a.totalHours)} / {num(a.totalCycles)}
                      </td>
                      <td>
                        {a.currentOperator?.name ?? (
                          <span className="t3">—</span>
                        )}
                        {a.currentOperator?.sanctionsStatus === 'FLAGGED' && (
                          <span
                            className="badge badge-amber"
                            style={{ marginLeft: 6, fontSize: 9 }}
                          >
                            sanctions
                          </span>
                        )}
                        {a.currentOperator?.sanctionsStatus === 'BLOCKED' && (
                          <span
                            className="badge badge-red"
                            style={{ marginLeft: 6, fontSize: 9 }}
                          >
                            bloqué
                          </span>
                        )}
                      </td>
                      <td
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color:
                            days === null
                              ? 'var(--text-3)'
                              : days <= 90
                                ? 'var(--red)'
                                : days <= 180
                                  ? 'var(--amber)'
                                  : 'var(--text-2)',
                        }}
                      >
                        {contract ? `${days} j` : '—'}
                      </td>
                      <td className="mono">
                        <strong>
                          {val
                            ? moneyCompact(Number(val.baseValue), val.currency)
                            : '—'}
                        </strong>
                      </td>
                      <td>
                        <span className={`badge badge-${status.tone}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="disclaimer">
          Colonne « Valeur » : Base Value estimée par le moteur algorithmique
          AeroOS. Estimation non certifiée — voir le module Valorisation pour la
          méthodologie et la traçabilité des sources.
        </div>
      </div>
    </>
  );
}
