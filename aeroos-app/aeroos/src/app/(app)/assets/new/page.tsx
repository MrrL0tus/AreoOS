import { requireRole, ForbiddenError } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AircraftForm from '../AircraftForm';

export const dynamic = 'force-dynamic';

export default async function NewAircraftPage() {
  try {
    await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <>
          <div className="topbar">
            <div className="topbar-title">Nouvel actif</div>
          </div>
          <div className="content">
            <div className="error-box">
              Rôle insuffisant pour créer un actif (ANALYST minimum requis).
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
          <div className="topbar-title">Nouvel actif</div>
          <div className="topbar-sub">Enregistrement manuel dans le registre</div>
        </div>
      </div>

      <div className="content">
        <AircraftForm mode="create" />
      </div>
    </>
  );
}
