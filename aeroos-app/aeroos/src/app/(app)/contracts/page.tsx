import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import {
  money,
  moneyCompact,
  date,
  daysUntil,
  paymentStatus,
} from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'gray' },
  NEGOTIATION: { label: 'Négociation', tone: 'blue' },
  SIGNED: { label: 'Signé', tone: 'blue' },
  ACTIVE: { label: 'Actif', tone: 'green' },
  EXPIRING: { label: 'Expire bientôt', tone: 'amber' },
  TERMINATED: { label: 'Résilié', tone: 'red' },
  COMPLETED: { label: 'Terminé', tone: 'gray' },
};

export default async function ContractsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { contracts, recentPayments } = await withTenant(
    session.tenantId,
    async (tx) => {
      const [contracts, recentPayments] = await Promise.all([
        tx.leaseContract.findMany({
          where: { deletedAt: null },
          orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
          include: {
            aircraft: {
              select: { id: true, msn: true, manufacturer: true, model: true },
            },
            lessee: { select: { name: true, sanctionsStatus: true } },
            _count: { select: { payments: true } },
          },
        }),
        tx.payment.findMany({
          where: { status: { in: ['DUE', 'OVERDUE', 'PARTIAL'] } },
          orderBy: { dueDate: 'asc' },
          take: 8,
          include: {
            contract: {
              select: {
                reference: true,
                currency: true,
                lessee: { select: { name: true } },
              },
            },
          },
        }),
      ]);
      return { contracts, recentPayments };
    }
  );

  const activeCount = contracts.filter(
    (c) => c.status === 'ACTIVE'
  ).length;

  const totalMonthlyRent = contracts
    .filter((c) => c.status === 'ACTIVE')
    .reduce((s, c) => s + Number(c.monthlyRent), 0);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Contrats de leasing</div>
          <div className="topbar-sub">
            {contracts.length} contrat(s) · {activeCount} actif(s) ·{' '}
            {moneyCompact(totalMonthlyRent, 'USD')} / mois
          </div>
        </div>
        <button className="btn btn-ghost">↓ Export</button>
        <button className="btn btn-primary">+ Nouveau contrat</button>
      </div>

      <div className="content">
        {contracts.length === 0 ? (
          <div className="card">
            <div className="empty">
              Aucun contrat enregistré.
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
                  <th>Référence</th>
                  <th>Actif</th>
                  <th>Locataire</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th>Reste</th>
                  <th>Loyer / mois</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const st = CONTRACT_STATUS[c.status] ?? {
                    label: c.status,
                    tone: 'gray',
                  };
                  const days = daysUntil(c.endDate);
                  const isLive = c.status === 'ACTIVE';

                  return (
                    <tr key={c.id}>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {c.reference}
                        {c.extractedByAi && (
                          <span
                            className="badge badge-purple"
                            style={{ marginLeft: 6, fontSize: 9 }}
                          >
                            IA
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/assets/${c.aircraft.id}`}
                          className="mono"
                          style={{ color: 'var(--blue)' }}
                        >
                          {c.aircraft.msn}
                        </Link>
                        <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                          {c.aircraft.manufacturer} {c.aircraft.model}
                        </div>
                      </td>
                      <td>
                        {c.lessee.name}
                        {c.lessee.sanctionsStatus === 'FLAGGED' && (
                          <span
                            className="badge badge-amber"
                            style={{ marginLeft: 6, fontSize: 9 }}
                          >
                            sanctions
                          </span>
                        )}
                      </td>
                      <td className="mono t2" style={{ fontSize: 11.5 }}>
                        {date(c.startDate)}
                      </td>
                      <td className="mono t2" style={{ fontSize: 11.5 }}>
                        {date(c.endDate)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color:
                            !isLive || days === null
                              ? 'var(--text-3)'
                              : days <= 90
                                ? 'var(--red)'
                                : days <= 180
                                  ? 'var(--amber)'
                                  : 'var(--text-2)',
                        }}
                      >
                        {isLive && days !== null ? `${days} j` : '—'}
                      </td>
                      <td className="mono">
                        <strong>
                          {money(Number(c.monthlyRent), c.currency)}
                        </strong>
                      </td>
                      <td>
                        <span className={`badge badge-${st.tone}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Paiements à surveiller ── */}
        <div className="card">
          <div className="card-title">Paiements échus ou en retard</div>
          {recentPayments.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--green)' }}>
              ✓ Aucun paiement en souffrance.
            </div>
          ) : (
            recentPayments.map((p) => {
              const st = paymentStatus(p.status);
              const late = daysUntil(p.dueDate);
              return (
                <div key={p.id} className="row-detail">
                  <span className="row-label">
                    <span className="mono">{p.periodLabel}</span> ·{' '}
                    {p.contract.lessee.name}
                    <span
                      className="mono"
                      style={{ color: 'var(--text-3)', marginLeft: 6 }}
                    >
                      {p.contract.reference}
                    </span>
                  </span>
                  <span className="row-value">
                    <span className="mono">
                      {money(Number(p.amountDue), p.contract.currency)}
                    </span>
                    {late !== null && late < 0 && (
                      <span
                        style={{
                          color: 'var(--red)',
                          fontSize: 11,
                          marginLeft: 8,
                        }}
                      >
                        +{Math.abs(late)} j
                      </span>
                    )}
                    <span
                      className={`badge badge-${st.tone}`}
                      style={{ marginLeft: 8, fontSize: 9 }}
                    >
                      {st.label}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
