import { currentUser, login, logout, register, updateSettings } from '@/server/auth';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action !== 'me') return Response.json({ error: 'Не найдено.' }, { status: 404 });
  const user = await currentUser();
  return user ? Response.json({ user }) : Response.json({ error: 'Требуется вход.' }, { status: 401 });
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action === 'logout') { await logout(); return Response.redirect(new URL('/login', request.url), 303); }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  try {
    if (action === 'register') return Response.json({ user: await register(String(body.username ?? ''), String(body.password ?? '')) }, { status: 201 });
    if (action === 'login') return Response.json({ user: await login(String(body.username ?? ''), String(body.password ?? '')) });
    if (action === 'settings') {
      const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
      return Response.json({ user: await updateSettings(user.id, body as Parameters<typeof updateSettings>[1]) });
    }
    return Response.json({ error: 'Не найдено.' }, { status: 404 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Не удалось выполнить запрос.' }, { status: 400 }); }
}
