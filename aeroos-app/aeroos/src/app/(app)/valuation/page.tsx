import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { moneyCompact, date, aircraftLabel } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ValuationPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const valuations = await withTenant(session.tenantId, (tx) =>
    tx.valuationRecord.findMany({
      where: { deletedAt: null },
      orderBy: { valuationDate: 'desc' },
      take: 50,
      include: {
        aircraft: {
          select: {
            id: true,
            msn: true,
            manufacturer: true,
            model: true,
            variant: true,
            yearBuilt: true,
          },
        },
      },
    })
  );

  const total = valuations
    .filter((v, i, arr) => arr.findIndex((x) => x.aircraftId === v.aircraftId) === i)
    .reduce((s, v) => s + Number(v.baseValue), 0);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Valorisation</div>
          <div className="topbar-sub">
            {valuations.length} enregistrement(s) · portefeuille{' '}
            {moneyCompact(total, 'USD')}
          </div>
        </div>
        <button className="btn btn-primary">Lancer un recalcul</button>
      </div>

      <div className="content">
        <div className="disclaimer">
          <strong>Estimations non certifiées.</strong> Les valeurs marquées
          « Algorithmique » sont calculées par le moteur AeroOS à partir de
          paramètres de marché. Elles ne constituent pas des appraisals
          certifiés au sens des standards ISTAT / ASA et ne peuvent servir de
          base à un financement bancaire, un reporting réglementaire ou un
          litige.
        </div>

        {valuations.length === 0 ? (
          <div className="card">
            <div className="empty">
              Aucune valorisation.
              <br />
              <span style={{ fontSize: 11.5 }}>
                Lancez <span className="mono">npm run valuation:refresh</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Actif</th>
                  <th>Type</th>
                  <th>Base Value</th>
                  <th>Market Value</th>
                  <th>Résiduelle</th>
                  <th>Source</th>
                  <th>Nature</th>
                </tr>
              </thead>
              <tbody>
                {valuations.map((v) => (
                  <tr key={v.id}>
                    <td className="mono t2" style={{ fontSize: 11.5 }}>
                      {date(v.valuationDate)}
                    </td>
                    <td>
                      <Link
                        href={`/assets/${v.aircraft.id}`}
                        className="mono"
                        style={{ color: 'var(--blue)' }}
                      >
                        {v.aircraft.msn}
                      </Link>
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {aircraftLabel(v.aircraft)}
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                        {v.aircraft.yearBuilt}
                      </div>
                    </td>
                    <td className="mono">
                      <strong>
                        {moneyCompact(Number(v.baseValue), v.currency)}
                      </strong>
                    </td>
                    <td className="mono t2">
                      {v.currentMarketValue
                        ? moneyCompact(Number(v.currentMarketValue), v.currency)
                        : '—'}
                    </td>
                    <td className="mono t2">
                      {v.residualValue
                        ? moneyCompact(Number(v.residualValue), v.currency)
                        : '—'}
                    </td>
                    <td className="t3" style={{ fontSize: 11 }}>
                      {v.source ?? '—'}
                    </td>
                    <td>
                      <span
                        className={`badge badge-${v.isCertified ? 'green' : 'gray'}`}
                      >
                        {v.isCertified ? 'Certifiée' : 'Algorithmique'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
