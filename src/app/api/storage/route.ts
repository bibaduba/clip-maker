import { currentUser } from '@/server/auth';
import { cleanupCache, cleanupExpiredCache, getStorageUsage } from '@/server/storage-cleanup';

export const runtime = 'nodejs';

export async function GET() {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const cleaned = await cleanupExpiredCache(user.id, user.cacheRetentionDays);
  return Response.json({ usage: await getStorageUsage(user.id), cleaned, retentionDays: user.cacheRetentionDays }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  if ((body as { action?: unknown })?.action !== 'cleanup-cache') return Response.json({ error: 'Неизвестное действие.' }, { status: 400 });
  const cleaned = await cleanupCache(user.id);
  return Response.json({ usage: await getStorageUsage(user.id), cleaned });
}
