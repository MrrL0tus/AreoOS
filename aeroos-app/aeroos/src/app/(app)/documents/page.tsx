import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { date, daysUntil } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  CERTIFICATE: 'Certificat',
  CONTRACT: 'Contrat',
  INSURANCE: 'Assurance',
  MAINTENANCE: 'Maintenance',
  INSPECTION: 'Inspection',
  FINANCIAL: 'Financier',
  OTHER: 'Autre',
};

export default async function DocumentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const documents = await withTenant(session.tenantId, (tx) =>
    tx.document.findMany({
      where: { deletedAt: null },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
      take: 60,
      include: {
        aircraft: { select: { id: true, msn: true } },
      },
    })
  );

  const expiringSoon = documents.filter((d) => {
    const days = daysUntil(d.expiryDate);
    return days !== null && days <= 90;
  }).length;

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Document Vault</div>
          <div className="topbar-sub">
            {documents.length} document(s)
            {expiringSoon > 0 && ` · ${expiringSoon} expire(nt) sous 90 jours`}
          </div>
        </div>
        <button className="btn btn-primary">↑ Déposer</button>
      </div>

      <div className="content">
        <div className="disclaimer">
          <strong>Module en construction.</strong> Le modèle de données et le
          contrôle d&apos;accès sont en place. L&apos;upload vers stockage S3
          chiffré et l&apos;indexation full-text restent à implémenter.
        </div>

        {documents.length === 0 ? (
          <div className="card">
            <div className="empty">Aucun document enregistré.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Titre</th>
                  <th>Catégorie</th>
                  <th>Actif</th>
                  <th>Version</th>
                  <th>Émission</th>
                  <th>Expiration</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => {
                  const days = daysUntil(d.expiryDate);
                  return (
                    <tr key={d.id}>
                      <td style={{ fontSize: 12 }}>{d.title}</td>
                      <td>
                        <span className="badge badge-gray">
                          {CATEGORY_LABELS[d.category] ?? d.category}
                        </span>
                      </td>
                      <td>
                        {d.aircraft ? (
                          <Link
                            href={`/assets/${d.aircraft.id}`}
                            className="mono"
                            style={{ color: 'var(--blue)' }}
                          >
                            {d.aircraft.msn}
                          </Link>
                        ) : (
                          <span className="t3">—</span>
                        )}
                      </td>
                      <td className="mono t3" style={{ fontSize: 11 }}>
                        v{d.version}
                      </td>
                      <td className="mono t2" style={{ fontSize: 11.5 }}>
                        {date(d.issueDate)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color:
                            days === null
                              ? 'var(--text-3)'
                              : days <= 30
                                ? 'var(--red)'
                                : days <= 90
                                  ? 'var(--amber)'
                                  : 'var(--text-2)',
                        }}
                      >
                        {d.expiryDate ? `${date(d.expiryDate)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
