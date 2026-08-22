import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { withTenant, audit } from '@/lib/db';
import { money, date, daysUntil, aircraftLabel } from '@/lib/format';
import Link from 'next/link';
import PaymentRow from './PaymentRow';

export const dynamic = 'force-dynamic';

const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'gray' },
  NEGOTIATION: { label: 'Négociation', tone: 'blue' },
  SIGNED: { label: 'Signé', tone: 'blue' },
  ACTIVE: { label: 'Actif', tone: 'green' },
  REDELIVERY: { label: 'Restitution', tone: 'amber' },
  TERMINATED: { label: 'Résilié', tone: 'red' },
  EXPIRED: { label: 'Expiré', tone: 'gray' },
};

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/login');

  const contract = await withTenant(session.tenantId, (tx) =>
    tx.leaseContract.findFirst({
      where: { id, deletedAt: null },
      include: {
        aircraft: {
          select: { id: true, msn: true, manufacturer: true, model: true, variant: true },
        },
        lessee: { select: { name: true, sanctionsStatus: true, country: true } },
        payments: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
  );

  if (!contract) notFound();

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'VIEW',
    resourceType: 'LeaseContract',
    resourceId: contract.id,
  });

  const status = CONTRACT_STATUS[contract.status] ?? { label: contract.status, tone: 'gray' };
  const days = daysUntil(contract.endDate);
  const totalDue = contract.payments.reduce((s, p) => s + Number(p.amountDue), 0);
  const totalReceived = contract.payments
    .filter((p) => p.status === 'RECEIVED' || p.status === 'PARTIAL')
    .reduce((s, p) => s + Number(p.amountReceived ?? p.amountDue), 0);
  const mrTotal =
    Number(contract.mrEngineLeft ?? 0) +
    Number(contract.mrEngineRight ?? 0) +
    Number(contract.mrApu ?? 0) +
    Number(contract.mrLandingGear ?? 0) +
    Number(contract.mrAirframe ?? 0);

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">
            <Link href="/contracts" style={{ color: 'var(--text-3)' }}>
              Contrats
            </Link>
            <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>/</span>
            <span className="mono">{contract.reference}</span>
          </div>
          <div className="topbar-sub">
            {contract.lessee.name} ·{' '}
            <Link href={`/assets/${contract.aircraft.id}`} style={{ color: 'var(--blue)' }}>
              {contract.aircraft.msn}
            </Link>
          </div>
        </div>
        {contract.lessee.sanctionsStatus === 'FLAGGED' && (
          <span className="badge badge-amber" style={{ marginRight: 8 }}>
            locataire signalé
          </span>
        )}
        <span className={`badge badge-${status.tone}`} style={{ fontSize: 12, padding: '4px 12px' }}>
          {status.label}
        </span>
      </div>

      <div className="content">
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">Loyer mensuel</div>
            <div className="kpi-value">{money(Number(contract.monthlyRent), contract.currency, { compact: true })}</div>
            <div className="kpi-sub">{contract.currency}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Échéance</div>
            <div className="kpi-value">
              {contract.status === 'ACTIVE' && days !== null ? days : '—'}
            </div>
            <div className="kpi-sub">
              {contract.status === 'ACTIVE' ? 'jours restants' : date(contract.endDate)}
            </div>
          </div>
          <div className="kpi teal">
            <div className="kpi-label">Encaissé</div>
            <div className="kpi-value">{money(totalReceived, contract.currency, { compact: true })}</div>
            <div className="kpi-sub">sur {money(totalDue, contract.currency, { compact: true })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">MR total / mois</div>
            <div className="kpi-value">{money(mrTotal, contract.currency, { compact: true })}</div>
            <div className="kpi-sub">toutes réserves</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-title">Parties &amp; actif</div>
            <div className="row-detail">
              <span className="row-label">Bailleur</span>
              <span className="row-value">{contract.lessorName}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Locataire</span>
              <span className="row-value">
                {contract.lessee.name}
                {contract.lessee.country ? ` (${contract.lessee.country})` : ''}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Actif</span>
              <span className="row-value mono">
                {contract.aircraft.msn} · {aircraftLabel(contract.aircraft)}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Période</span>
              <span className="row-value" style={{ fontSize: 11.5 }}>
                {date(contract.startDate)} → {date(contract.endDate)}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Signature</span>
              <span className="row-value">{date(contract.signedDate)}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Livraison</span>
              <span className="row-value">{date(contract.deliveryDate)}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Droit applicable</span>
              <span className="row-value">{contract.governingLaw ?? '—'}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Juridiction</span>
              <span className="row-value">{contract.jurisdiction ?? '—'}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Conditions financières</div>
            <div className="row-detail">
              <span className="row-label">Dépôt de garantie</span>
              <span className="row-value mono">
                {contract.securityDeposit
                  ? money(Number(contract.securityDeposit), contract.currency)
                  : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Indexation</span>
              <span className="row-value mono" style={{ fontSize: 11.5 }}>
                {contract.escalationClause ?? '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MR moteur gauche</span>
              <span className="row-value mono">
                {contract.mrEngineLeft ? money(Number(contract.mrEngineLeft), contract.currency) : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MR moteur droit</span>
              <span className="row-value mono">
                {contract.mrEngineRight ? money(Number(contract.mrEngineRight), contract.currency) : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MR APU</span>
              <span className="row-value mono">
                {contract.mrApu ? money(Number(contract.mrApu), contract.currency) : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MR train d&apos;atterrissage</span>
              <span className="row-value mono">
                {contract.mrLandingGear ? money(Number(contract.mrLandingGear), contract.currency) : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">MR cellule</span>
              <span className="row-value mono">
                {contract.mrAirframe ? money(Number(contract.mrAirframe), contract.currency) : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Options &amp; clauses</div>
          <div className="row-detail">
            <span className="row-label">Option d&apos;achat</span>
            <span className="row-value">{contract.hasPurchaseOption ? 'Oui' : 'Non'}</span>
          </div>
          <div className="row-detail">
            <span className="row-label">Option d&apos;extension</span>
            <span className="row-value">{contract.hasExtensionOption ? 'Oui' : 'Non'}</span>
          </div>
          <div className="row-detail">
            <span className="row-label">Résiliation anticipée</span>
            <span className="row-value">{contract.hasEarlyTermination ? 'Possible' : 'Non prévue'}</span>
          </div>
          {contract.returnConditions && (
            <div className="row-detail">
              <span className="row-label">Return conditions</span>
              <span className="row-value" style={{ fontSize: 11.5, textAlign: 'left', maxWidth: '60%' }}>
                {contract.returnConditions}
              </span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            Échéancier ({contract.payments.length} paiement{contract.payments.length > 1 ? 's' : ''})
          </div>
          {contract.payments.length === 0 ? (
            <div className="empty">
              Aucune échéance générée.
              {contract.status !== 'ACTIVE' && (
                <>
                  <br />
                  <span style={{ fontSize: 11.5 }}>
                    Les paiements sont générés automatiquement lorsque le contrat passe au statut « Actif ».
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Période</th>
                    <th>Échéance</th>
                    <th>Montant dû</th>
                    <th>Reçu</th>
                    <th>Statut</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {contract.payments.map((p) => (
                    <PaymentRow
                      key={p.id}
                      contractId={contract.id}
                      payment={{
                        id: p.id,
                        periodLabel: p.periodLabel,
                        dueDate: p.dueDate.toISOString(),
                        amountDue: Number(p.amountDue),
                        currency: p.currency,
                        receivedDate: p.receivedDate ? p.receivedDate.toISOString() : null,
                        amountReceived: p.amountReceived ? Number(p.amountReceived) : null,
                        status: p.status,
                        notes: p.notes,
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
