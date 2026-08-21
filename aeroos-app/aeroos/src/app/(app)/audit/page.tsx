import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { date } from '@/lib/format';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  CREATE: { label: 'Création', tone: 'green' },
  UPDATE: { label: 'Modification', tone: 'blue' },
  DELETE: { label: 'Suppression', tone: 'red' },
  LOGIN: { label: 'Connexion', tone: 'gray' },
  LOGOUT: { label: 'Déconnexion', tone: 'gray' },
  EXPORT: { label: 'Export', tone: 'amber' },
  VIEW: { label: 'Consultation', tone: 'gray' },
  AI_EXTRACT: { label: 'Extraction IA', tone: 'purple' },
  AI_VALIDATE: { label: 'Validation IA', tone: 'purple' },
};

export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const logs = await withTenant(session.tenantId, (tx) =>
    tx.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        userEmail: true,
        action: true,
        resourceType: true,
        resourceId: true,
        result: true,
        ipAddress: true,
      },
    })
  );

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Journal d&apos;audit</div>
          <div className="topbar-sub">
            100 dernières entrées · registre immuable
          </div>
        </div>
      </div>

      <div className="content">
        <div className="disclaimer">
          Ce journal est en écriture seule (append-only). Aucune entrée ne peut
          être modifiée ni supprimée, y compris par un administrateur. Rétention
          minimale : 7 ans.
        </div>

        {logs.length === 0 ? (
          <div className="card">
            <div className="empty">Aucune entrée d&apos;audit.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Horodatage</th>
                  <th>Utilisateur</th>
                  <th>Action</th>
                  <th>Ressource</th>
                  <th>Identifiant</th>
                  <th>Origine</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const a = ACTION_LABELS[l.action] ?? {
                    label: l.action,
                    tone: 'gray',
                  };
                  return (
                    <tr key={l.id}>
                      <td className="mono t2" style={{ fontSize: 11 }}>
                        {l.createdAt.toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{l.userEmail ?? '—'}</td>
                      <td>
                        <span className={`badge badge-${a.tone}`}>
                          {a.label}
                        </span>
                      </td>
                      <td className="t2" style={{ fontSize: 11.5 }}>
                        {l.resourceType}
                      </td>
                      <td className="mono t3" style={{ fontSize: 10.5 }}>
                        {l.resourceId ? l.resourceId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="mono t3" style={{ fontSize: 10.5 }}>
                        {l.ipAddress ?? '—'}
                      </td>
                      <td>
                        <span
                          className={`badge badge-${
                            l.result === 'SUCCESS'
                              ? 'green'
                              : l.result === 'DENIED'
                                ? 'red'
                                : 'amber'
                          }`}
                        >
                          {l.result}
                        </span>
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
