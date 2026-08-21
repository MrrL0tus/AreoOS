'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavItem({
  href,
  icon,
  label,
  badge,
  badgeTone,
}: {
  href: string;
  icon: string;
  label: string;
  badge?: number;
  badgeTone?: 'purple';
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');

  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`}>
      <span className="nav-icon">{icon}</span>
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`nav-badge${badgeTone ? ' ' + badgeTone : ''}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}
