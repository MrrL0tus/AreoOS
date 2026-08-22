import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { withTenant, audit } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { date, daysUntil } from '@/lib/format';
import Link from 'next/link';
import SummaryPanel from './SummaryPanel';
import type { ReportSummaryData } from './SummaryPanel';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  CERTIFICATE: 'Certificat',
  CONTRACT: 'Contrat',
  MAINTENANCE: 'Maintenance',
  INSPECTION: 'Inspection',
  FINANCIAL: 'Financier',
  OTHER: 'Autre',
};

const ROLE_HIERARCHY: Record<string, number> = { ADMIN: 4, MANAGER: 3, ANALYST: 2, VIEWER: 1 };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/login');

  const document = await withTenant(session.tenantId, (tx) =>
    tx.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        aircraft: { select: { id: true, msn: true } },
        contract: { select: { id: true, reference: true } },
      },
    })
  );
  if (!document) notFound();

  await audit({
    tenantId: session.tenantId,
    userId: session.userId,
    userEmail: session.email,
    action: 'VIEW',
    resourceType: 'Document',
    resourceId: document.id,
  });

  const downloadUrl = await getStorage().sign(document.storageKey, 300);
  const days = daysUntil(document.expiryDate);
  const canGenerate = (ROLE_HIERARCHY[session.role] ?? 0) >= ROLE_HIERARCHY.ANALYST;

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">
            <Link href="/documents" style={{ color: 'var(--text-3)' }}>Documents</Link>
            <span style={{ color: 'var(--text-3)', margin: '0 6px' }}>/</span>
            {document.title}
          </div>
          <div className="topbar-sub">
            {CATEGORY_LABELS[document.category] ?? document.category}
            {document.subcategory ? ` · ${document.subcategory}` : ''}
          </div>
        </div>
        <a href={downloadUrl} className="btn btn-primary">↓ Télécharger</a>
      </div>

      <div className="content">
        <div className="grid-2">
          <div className="card">
            <div className="card-title">Métadonnées</div>
            <div className="row-detail">
              <span className="row-label">Fichier</span>
              <span className="row-value mono" style={{ fontSize: 11.5 }}>{document.filename}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Taille</span>
              <span className="row-value mono">{formatBytes(document.sizeBytes)}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Version</span>
              <span className="row-value mono">v{document.version}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Actif</span>
              <span className="row-value">
                {document.aircraft ? (
                  <Link href={`/assets/${document.aircraft.id}`} style={{ color: 'var(--blue)' }}>
                    {document.aircraft.msn}
                  </Link>
                ) : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Contrat</span>
              <span className="row-value">
                {document.contract ? (
                  <Link href={`/contracts/${document.contract.id}`} style={{ color: 'var(--blue)' }}>
                    {document.contract.reference}
                  </Link>
                ) : '—'}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Navigabilité</div>
            <div className="row-detail">
              <span className="row-label">Émission</span>
              <span className="row-value">{date(document.issueDate)}</span>
            </div>
            <div className="row-detail">
              <span className="row-label">Expiration</span>
              <span
                className="row-value"
                style={{
                  color: days !== null && days <= 30 ? 'var(--red)' : days !== null && days <= 90 ? 'var(--amber)' : undefined,
                }}
              >
                {document.expiryDate ? `${date(document.expiryDate)}${days !== null ? ` (${days} j)` : ''}` : '—'}
              </span>
            </div>
            <div className="row-detail">
              <span className="row-label">Déposé le</span>
              <span className="row-value">{date(document.createdAt)}</span>
            </div>
          </div>
        </div>

        <SummaryPanel
          documentId={document.id}
          canGenerate={canGenerate}
          canRegenerate={canGenerate}
          hasExtractedText={Boolean(document.extractedText)}
          aiSummary={document.aiSummary}
          aiSummaryData={document.aiSummaryData as unknown as ReportSummaryData | null}
          aiSummaryModel={document.aiSummaryModel}
          aiSummaryFeedback={document.aiSummaryFeedback}
        />
      </div>
    </>
  );
}
