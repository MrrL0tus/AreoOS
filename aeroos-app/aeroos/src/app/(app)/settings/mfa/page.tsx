import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { withTenant } from '@/lib/db';
import MfaPanel from './MfaPanel';

export const dynamic = 'force-dynamic';

export default async function MfaSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await withTenant(session.tenantId, (tx) =>
    tx.user.findFirst({
      where: { id: session.userId, deletedAt: null },
      select: { mfaEnabled: true, mfaRecoveryCodes: true },
    })
  );

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Authentification à deux facteurs</div>
          <div className="topbar-sub">Sécurité du compte</div>
        </div>
      </div>

      <div className="content">
        <MfaPanel
          initialEnabled={user?.mfaEnabled ?? false}
          remainingRecoveryCodes={user?.mfaRecoveryCodes.length ?? 0}
        />
      </div>
    </>
  );
}
