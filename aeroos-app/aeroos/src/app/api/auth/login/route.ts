import { NextResponse } from 'next/server';
import { z } from 'zod';
import { login } from '@/lib/auth';

const schema = z.object({
  email: z.string().email('Adresse e-mail invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Requête invalide' },
      { status: 400 }
    );
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const result = await login(parsed.data.email, parsed.data.password, {
    ipAddress: forwarded?.split(',')[0]?.trim(),
    userAgent: request.headers.get('user-agent') ?? undefined,
  });

  if (!result.success) {
    // Statut et message volontairement génériques — cf. lib/auth.ts
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
