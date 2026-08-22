import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, logout } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { initials } from '@/lib/format';
import NavItem from '@/components/NavItem';
import SessionRenewer from '@/components/SessionRenewer';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const counts = await withTenant(session.tenantId, async (tx) => {
    const [alerts, criticalAlerts, pendingAi] = await Promise.all([
      tx.alert.count({ where: { resolvedAt: null, deletedAt: null } }),
      tx.alert.count({
        where: { resolvedAt: null, deletedAt: null, severity: 'CRITICAL' },
      }),
      tx.aiExtraction.count({ where: { status: 'PENDING', deletedAt: null } }),
    ]);
    return { alerts, criticalAlerts, pendingAi };
  });

  async function doLogout() {
    'use server';
    await logout();
    redirect('/login');
  }

  return (
    <div className="shell">
      <SessionRenewer />
      <nav className="sidebar">
        <div className="logo">
          <div className="logo-mark">
            Aero<span>OS</span>
          </div>
          <div className="logo-sub">Asset Management</div>
        </div>

        <div className="nav-section">Portefeuille</div>
        <NavItem href="/portfolio" icon="⬡" label="Portfolio" />
        <NavItem href="/assets" icon="✈" label="Actifs" />
        <NavItem
          href="/contracts" icon="⊟" label="Contrats"
          badge={counts.criticalAlerts > 0 ? counts.criticalAlerts : undefined}
        />

        <div className="nav-section">Analyse</div>
        <NavItem href="/valuation" icon="◈" label="Valorisation" />
        <NavItem href="/documents" icon="⊡" label="Documents" />
        <NavItem
          href="/ai" icon="◉" label="Intelligence IA"
          badge={counts.pendingAi > 0 ? counts.pendingAi : undefined}
          badgeTone="purple"
        />

        <div className="nav-section">Système</div>
        <NavItem href="/audit" icon="⊙" label="Journal d'audit" />
        <NavItem href="/settings/mfa" icon="⚿" label="Sécurité" />
        <NavItem href="/settings/password" icon="⚷" label="Mot de passe" />

        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="avatar">
              {initials(session.firstName, session.lastName)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="user-name">
                {session.firstName} {session.lastName}
              </div>
              <div className="user-role">{session.role}</div>
            </div>
            <form action={doLogout}>
              <button
                type="submit"
                title="Se déconnecter"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-3)', fontSize: 14, padding: 4,
                }}
              >
                ⏻
              </button>
            </form>
          </div>
        </div>
      </nav>

      <div className="main">{children}</div>
    </div>
  );
}
