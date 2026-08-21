import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { money, moneyCompact, num, pct, date, daysUntil, severityTone } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const data = await withTenant(session.tenantId, async (tx) => {
    const [
      aircraft,
      activeContracts,
      alerts,
      latestValuations,
      duePayments,
    ] = await Promise.all([
      tx.aircraft.findMany({
        where: { deletedAt: null },
        select: { id: true, status: true, msn: true },
      }),
      tx.leaseContract.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          reference: true,
          endDate: true,
          monthlyRent: true,
          currency: true,
          mrEngineLeft: true,
          mrEngineRight: true,
          mrApu: true,
          mrLandingGear: true,
          mrAirframe: true,
          lessee: { select: { name: true } },
          aircraft: { select: { msn: true } },
        },
      }),
      tx.alert.findMany({
        where: { resolvedAt: null },
        orderBy: [{ severity: 'asc' }, { dueDate: 'asc' }],
        take: 6,
        select: {
          id: true,
          title: true,
          message: true,
          severity: true,
          dueDate: true,
        },
      }),
      tx.valuationRecord.findMany({
        orderBy: { valuationDate: 'desc' },
        distinct: ['aircraftId'],
        select: { aircraftId: true, baseValue: true, currency: true },
      }),
      tx.payment.count({ where: { status: { in: ['DUE', 'OVERDUE'] } } }),
    ]);

    return { aircraft, activeContracts, alerts, latestValuations, duePayments };
  });

  // ── Calculs de portefeuille ──────────────────────────────────
  const totalAssets = data.aircraft.length;
  const onLease = data.aircraft.filter((a) => a.status === 'ON_LEASE').length;
  const leaseRate = totalAssets > 0 ? onLease / totalAssets : 0;

  const portfolioValue = data.latestValuations.reduce(
    (sum, v) => sum + Number(v.baseValue),
    0
  );

  const monthlyRent = data.activeContracts.reduce(
    (sum, c) => sum + Number(c.monthlyRent),
    0
  );

  const monthlyMr = data.activeContracts.reduce(
    (sum, c) =>
      sum +
      Number(c.mrEngineLeft ?? 0) +
      Number(c.mrEngineRight ?? 0) +
      Number(c.mrApu ?? 0) +
      Number(c.mrLandingGear ?? 0) +
      Number(c.mrAirframe ?? 0),
    0
  );

  const monthlyCashflow = monthlyRent + monthlyMr;
  const grossYield =
    portfolioValue > 0 ? (monthlyRent * 12) / portfolioValue : 0;

  const criticalAlerts = data.alerts.filter(
    (a) => a.severity === 'CRITICAL' || a.severity === 'HIGH'
  ).length;

  // Concentration par locataire (règle 30 % du cahier fonctionnel)
  const byLessee = new Map<string, number>();
  for (const c of data.activeContracts) {
    const key = c.lessee.name;
    byLessee.set(key, (byLessee.get(key) ?? 0) + Number(c.monthlyRent));
  }
  const concentration = [...byLessee.entries()]
    .map(([name, rent]) => ({
      name,
      share: monthlyRent > 0 ? rent / monthlyRent : 0,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 5);

  const breach = concentration.filter((c) => c.share > 0.3);

  // Échéancier : contrats expirant dans les 12 mois
  const expiringSoon = data.activeContracts
    .map((c) => ({ ...c, days: daysUntil(c.endDate) ?? 9999 }))
    .filter((c) => c.days <= 365)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Portfolio</div>
          <div className="topbar-sub">
            {totalAssets} actifs · {data.activeContracts.length} contrats actifs
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '5px 12px',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
            Valeur totale
          </span>
          <span
            className="mono"
            style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)' }}
          >
            {moneyCompact(portfolioValue, 'EUR')}
          </span>
        </div>
      </div>

      <div className="content">
        {/* ── KPIs ── */}
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">Actifs totaux</div>
            <div className="kpi-value">{totalAssets}</div>
            <div className="kpi-sub">{onLease} sous contrat</div>
          </div>

          <div className="kpi green">
            <div className="kpi-label">Taux locatif</div>
            <div className="kpi-value">{pct(leaseRate)}</div>
            <div className="kpi-sub">
              {totalAssets - onLease} actif(s) disponible(s)
            </div>
          </div>

          <div className="kpi teal">
            <div className="kpi-label">Cash-flow mensuel</div>
            <div className="kpi-value">{moneyCompact(monthlyCashflow, 'USD')}</div>
            <div className="kpi-sub">Loyers + MR reserves</div>
          </div>

          <div className={criticalAlerts > 0 ? 'kpi red' : 'kpi'}>
            <div className="kpi-label">Alertes actives</div>
            <div className="kpi-value">{data.alerts.length}</div>
            <div className="kpi-sub">
              {criticalAlerts > 0
                ? `${criticalAlerts} critique(s)`
                : 'Aucune critique'}
            </div>
          </div>
        </div>

        <div className="grid-4">
          <div className="kpi purple">
            <div className="kpi-label">Rendement brut</div>
            <div className="kpi-value">{pct(grossYield)}</div>
            <div className="kpi-sub">Loyers annualisés / valeur</div>
          </div>

          <div className="kpi">
            <div className="kpi-label">Loyers mensuels</div>
            <div className="kpi-value">{moneyCompact(monthlyRent, 'USD')}</div>
            <div className="kpi-sub">Hors reserves</div>
          </div>

          <div className="kpi teal">
            <div className="kpi-label">MR mensuelles</div>
            <div className="kpi-value">{moneyCompact(monthlyMr, 'USD')}</div>
            <div className="kpi-sub">Provisions maintenance</div>
          </div>

          <div className={data.duePayments > 0 ? 'kpi amber' : 'kpi'}>
            <div className="kpi-label">Paiements en attente</div>
            <div className="kpi-value">{data.duePayments}</div>
            <div className="kpi-sub">Échus ou en retard</div>
          </div>
        </div>

        <div className="grid-2">
          {/* ── Alertes ── */}
          <div className="card">
            <div className="card-title">
              Alertes actives
              {criticalAlerts > 0 && (
                <span style={{ color: 'var(--red)', marginLeft: 6 }}>
                  ● {criticalAlerts} critique(s)
                </span>
              )}
            </div>

            {data.alerts.length === 0 ? (
              <div className="empty">Aucune alerte. Portefeuille sain.</div>
            ) : (
              data.alerts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border-2)',
                  }}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      marginTop: 4,
                      flexShrink: 0,
                      background:
                        a.severity === 'CRITICAL' || a.severity === 'HIGH'
                          ? 'var(--red)'
                          : a.severity === 'MEDIUM'
                            ? 'var(--amber)'
                            : 'var(--blue)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {a.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                        marginTop: 2,
                      }}
                    >
                      {a.message}
                      {a.dueDate && ` · ${date(a.dueDate)}`}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Concentration + échéances ── */}
          <div className="card">
            <div className="card-title">Concentration par locataire</div>

            {concentration.length === 0 ? (
              <div className="empty">Aucun contrat actif.</div>
            ) : (
              <>
                {concentration.map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 100,
                        fontSize: 11,
                        color: 'var(--text-2)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.name}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        height: 10,
                        background: 'var(--surface-2)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(c.share * 100, 100)}%`,
                          background:
                            c.share > 0.3 ? 'var(--red)' : 'var(--blue)',
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <div
                      className="mono"
                      style={{
                        width: 42,
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                        textAlign: 'right',
                      }}
                    >
                      {pct(c.share, 0)}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    fontSize: 10.5,
                    marginTop: 8,
                    color: breach.length > 0 ? 'var(--red)' : 'var(--green)',
                  }}
                >
                  {breach.length > 0
                    ? `⚠ Seuil de 30 % dépassé : ${breach.map((b) => b.name).join(', ')}`
                    : '✓ Règle des 30 % respectée pour tous les locataires'}
                </div>
              </>
            )}

            <div
              className="card-title"
              style={{ marginTop: 20, marginBottom: 10 }}
            >
              Contrats arrivant à échéance
            </div>

            {expiringSoon.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                Aucun contrat n&apos;expire dans les 12 prochains mois.
              </div>
            ) : (
              expiringSoon.map((c) => (
                <div key={c.id} className="row-detail">
                  <span className="row-label">
                    <span className="mono">{c.aircraft.msn}</span> ·{' '}
                    {c.lessee.name}
                  </span>
                  <span
                    className="row-value"
                    style={{
                      color:
                        c.days <= 90
                          ? 'var(--red)'
                          : c.days <= 180
                            ? 'var(--amber)'
                            : 'var(--text)',
                    }}
                  >
                    {c.days} j
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="disclaimer">
          Les valorisations affichées sont des estimations algorithmiques
          produites par le moteur AeroOS. Elles ne constituent pas des
          appraisals certifiés au sens des standards ISTAT / ASA et ne peuvent
          servir de base à un financement bancaire ou à un reporting
          réglementaire.
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          <Link href="/assets" style={{ color: 'var(--blue)' }}>
            Voir tous les actifs →
          </Link>
        </div>
      </div>
    </>
  );
}
