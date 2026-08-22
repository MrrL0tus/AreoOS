import { requireRole, ForbiddenError, getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import { aircraftLabel } from '@/lib/format';
import ContractForm from '../ContractForm';

export const dynamic = 'force-dynamic';

export default async function NewContractPage() {
  try {
    await requireRole('ANALYST');
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return (
        <>
          <div className="topbar">
            <div className="topbar-title">Nouveau contrat</div>
          </div>
          <div className="content">
            <div className="error-box">
              Rôle insuffisant pour créer un contrat (ANALYST minimum requis).
            </div>
          </div>
        </>
      );
    }
    redirect('/login');
  }

  const session = await getSession();
  if (!session) redirect('/login');

  const { aircraft, operators, tenant } = await withTenant(session.tenantId, async (tx) => {
    const [aircraft, operators, tenant] = await Promise.all([
      tx.aircraft.findMany({
        where: { deletedAt: null, status: { notIn: ['SOLD', 'PARTED_OUT'] } },
        orderBy: { msn: 'asc' },
        select: { id: true, msn: true, manufacturer: true, model: true, variant: true },
      }),
      tx.operator.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, sanctionsStatus: true },
      }),
      tx.tenant.findUniqueOrThrow({
        where: { id: session.tenantId },
        select: { name: true },
      }),
    ]);
    return { aircraft, operators, tenant };
  });

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Nouveau contrat</div>
          <div className="topbar-sub">Contrat de leasing</div>
        </div>
      </div>

      <div className="content">
        <ContractForm
          aircraftOptions={aircraft.map((a) => ({
            id: a.id,
            msn: a.msn,
            label: aircraftLabel(a),
          }))}
          operatorOptions={operators}
          defaultLessorName={tenant.name}
        />
      </div>
    </>
  );
}
