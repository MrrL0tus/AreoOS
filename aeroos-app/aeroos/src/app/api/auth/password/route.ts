import { NextResponse } from 'next/server';
import { z } from 'zod';
import { changePassword, UnauthorizedError } from '@/lib/auth';

const schema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: z.string().min(1, 'Nouveau mot de passe requis'),
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

  try {
    const result = await changePassword(
      parsed.data.currentPassword,
      parsed.data.newPassword,
      {
        ipAddress: forwarded?.split(',')[0]?.trim(),
        userAgent: request.headers.get('user-agent') ?? undefined,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }
}
