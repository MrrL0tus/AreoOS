import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { captureException } from '@/lib/error-tracking';

/**
 * Sonde de santé (T5.3) — pas d'authentification requise (consultée par
 * un load balancer / orchestrateur, pas par un utilisateur). `SELECT 1`
 * ne touche aucune table tenant-scopée : pas besoin de withTenant()/
 * asSystem() ici, le rôle applicatif (RLS) suffit.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'up' });
  } catch (err) {
    captureException(err, { event: 'health_check_failure', route: '/api/health' });
    return NextResponse.json({ status: 'error', database: 'down' }, { status: 503 });
  }
}
