import { requireRole, ForbiddenError, getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { withTenant } from '@/lib/db';
import AircraftForm from '../../AircraftForm';

export const dynamic = 'force-dynamic';

export default async function EditAircraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <>
          <div className="topbar">
            <div className="topbar-title">Modifier l&apos;actif</div>
          </div>
          <div className="content">
            <div className="error-box">
              Rôle insuffisant pour modifier un actif (ANALYST minimum requis).
            </div>
          </div>
        </>
      );
    }
    redirect('/login');
  }

  const session = await getSession();
  if (!session) redirect('/login');

  const aircraft = await withTenant(session.tenantId, (tx) =>
    tx.aircraft.findFirst({
      where: { id, deletedAt: null },
      select: {
        msn: true, registration: true, manufacturer: true, model: true,
        variant: true, yearBuilt: true, status: true, totalHours: true,
        totalCycles: true, cabinConfig: true, seatCount: true, mtowKg: true,
        cofaExpiryDate: true, insuranceExpiryDate: true,
      },
    })
  );

  if (!aircraft) notFound();

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Modifier l&apos;actif</div>
          <div className="topbar-sub mono">{aircraft.msn}</div>
        </div>
      </div>

      <div className="content">
        <AircraftForm mode="edit" aircraftId={id} initialValues={aircraft} />
      </div>
    </>
  );
}
