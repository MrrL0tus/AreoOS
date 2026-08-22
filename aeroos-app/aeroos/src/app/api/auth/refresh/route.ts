import { NextResponse } from 'next/server';
import { renewSession } from '@/lib/auth';

export async function POST() {
  const result = await renewSession();
  if (!result.renewed) {
    return NextResponse.json({ error: 'Session expirée' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
