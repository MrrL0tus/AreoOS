import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PasswordPanel from './PasswordPanel';

export const dynamic = 'force-dynamic';

export default async function PasswordSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <div className="topbar-title">Mot de passe</div>
          <div className="topbar-sub">Sécurité du compte</div>
        </div>
      </div>

      <div className="content">
        <PasswordPanel />
      </div>
    </>
  );
}
