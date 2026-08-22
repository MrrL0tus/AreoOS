import { requireRole, ForbiddenError } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ImportWizard from './ImportWizard';

export const dynamic = 'force-dynamic';

export default async function ImportAircraftPage() {
  try {
    await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <>
          <div className="topbar">
            <div className="topbar-title">Import CSV</div>
          </div>
          <div className="content">
            <div className="error-box">
              Rôle insuffisant pour importer des actifs (ANALYST minimum requis).
            </div>
          </div>
        </>
      );
    }
    redirect('/login');
  }

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Import CSV</div>
          <div className="topbar-sub">Charger un portefeuille d&apos;actifs en masse</div>
        </div>
      </div>

      <div className="content">
        <ImportWizard />
      </div>
    </>
  );
}
