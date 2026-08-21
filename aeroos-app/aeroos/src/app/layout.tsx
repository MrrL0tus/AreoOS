import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AeroOS — Asset Management Platform',
  description: 'Plateforme de gestion des actifs aéronautiques',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
