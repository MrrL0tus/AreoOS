import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { date, daysUntil } from '@/lib/format';
import { getStorage } from '@/lib/storage';
import Link from 'next/link';
import UploadPanel from './UploadPanel';

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

interface DocRow {
  id: string;
  title: string;
  category: string;
  version: number;
  issueDate: Date | null;
  expiryDate: Date | null;
  storageKey: string;
  aircraft: { id: string; msn: string } | null;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { q } = await searchParams;
  const query = q?.trim() || '';

  const { documents, aircraftOptions, totalCount } = await withTenant(
    session.tenantId,
    async (tx) => {
      const aircraftOptions = await tx.aircraft.findMany({
        where: { deletedAt: null },
        orderBy: { msn: 'asc' },
        select: { id: true, msn: true },
      });

      if (query) {
        // Recherche full-text (titre, sous-catégorie, contenu extrait des
        // PDF) — indexée par documents_search_idx (GIN), cf. rls.sql §5.
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            title: string;
            category: string;
            version: number;
            issueDate: Date | null;
            expiryDate: Date | null;
            storageKey: string;
            aircraftId: string | null;
            aircraftMsn: string | null;
          }>
        >`
          SELECT d.id, d.title, d.category, d.version, d."issueDate", d."expiryDate",
                 d."storageKey", d."aircraftId", a.msn AS "aircraftMsn"
          FROM documents d
          LEFT JOIN aircraft a ON a.id = d."aircraftId"
          WHERE d."deletedAt" IS NULL
            AND d.search_vector @@ plainto_tsquery('french', ${query})
          ORDER BY ts_rank(d.search_vector, plainto_tsquery('french', ${query})) DESC
          LIMIT 60
        `;
        const documents: DocRow[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          version: r.version,
          issueDate: r.issueDate,
          expiryDate: r.expiryDate,
          storageKey: r.storageKey,
          aircraft: r.aircraftId && r.aircraftMsn ? { id: r.aircraftId, msn: r.aircraftMsn } : null,
        }));
        return { documents, aircraftOptions, totalCount: documents.length };
      }

      const documents = await tx.document.findMany({
        where: { deletedAt: null },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
        take: 60,
        include: { aircraft: { select: { id: true, msn: true } } },
      });
      const totalCount = await tx.document.count({ where: { deletedAt: null } });
      return { documents, aircraftOptions, totalCount };
    }
  );

  const storage = getStorage();
  const downloadUrls = new Map(
    await Promise.all(
      documents.map(async (d) => [d.id, await storage.sign(d.storageKey, 300)] as const)
    )
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
            {query
              ? `${documents.length} résultat(s) pour « ${query} »`
              : `${totalCount} document(s)${expiringSoon > 0 ? ` · ${expiringSoon} expire(nt) sous 90 jours` : ''}`}
          </div>
        </div>
      </div>

      <div className="content">
        <UploadPanel aircraftOptions={aircraftOptions} />

        <form action="/documents" method="GET" style={{ margin: '16px 0' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Rechercher un titre, une sous-catégorie, un contenu de document…"
              className="input"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary">Rechercher</button>
            {query && (
              <Link href="/documents" className="btn btn-ghost">Effacer</Link>
            )}
          </div>
        </form>

        {process.env.STORAGE_DRIVER !== 's3' && (
          <div className="disclaimer" style={{ marginBottom: 16 }}>
            Stockage local (STORAGE_DRIVER=local) : pas de chiffrement au
            repos — limite documentée pour le développement sans compte
            cloud. Passer STORAGE_DRIVER=s3 en production (SSE-S3).
          </div>
        )}

        {documents.length === 0 ? (
          <div className="card">
            <div className="empty">
              {query ? 'Aucun document ne correspond à cette recherche.' : 'Aucun document enregistré.'}
            </div>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => {
                  const days = daysUntil(d.expiryDate);
                  return (
                    <tr key={d.id}>
                      <td style={{ fontSize: 12 }}>
                        <Link href={`/documents/${d.id}`} style={{ color: 'var(--blue)' }}>
                          {d.title}
                        </Link>
                      </td>
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
                      <td>
                        <a
                          href={downloadUrls.get(d.id)}
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                        >
                          ↓ Télécharger
                        </a>
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
