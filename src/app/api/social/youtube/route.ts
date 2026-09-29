import { currentUser } from '@/server/auth';
import { createYouTubePublication, deleteFailedPublication, disconnectYouTube, getYouTubeRefreshToken, hasYouTubeConnection, listClipPublications, listProjectPublications, listUserPublications, recoverStalledPublications, updatePublication } from '@/server/social';
import { startYouTubePublicationWorker } from '@/server/start-publication-worker';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Нужна авторизация.' }, { status: 401 });
  recoverStalledPublications(user.id);
  const params = new URL(request.url).searchParams;
  const clipId = params.get('clipId');
  const projectId = params.get('projectId');
  const all = params.get('all') === '1';
  return Response.json({ connected: hasYouTubeConnection(user.id), publications: clipId ? listClipPublications(user.id, clipId) : projectId ? listProjectPublications(user.id, projectId) : all ? listUserPublications(user.id) : [] });
}
export async function DELETE(request: Request) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Нужна авторизация.' }, { status: 401 });
  const publicationId = new URL(request.url).searchParams.get('publicationId');
  if (publicationId) {
    if (!/^[0-9a-f-]{36}$/u.test(publicationId)) return Response.json({ error: 'Некорректная публикация.' }, { status: 400 });
    try { deleteFailedPublication(user.id, publicationId); return Response.json({ deleted: true }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Не удалось удалить публикацию.' }, { status: 409 }); }
  }
  const token = getYouTubeRefreshToken(user.id);
  if (token) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => null);
  disconnectYouTube(user.id); return Response.json({ connected: false });
}
export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Нужна авторизация.' }, { status: 401 });
  if (!hasYouTubeConnection(user.id)) return Response.json({ error: 'Сначала подключите канал YouTube.' }, { status: 409 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const input = body as Record<string, unknown>; const title = String(input.title ?? '').trim(); const description = String(input.description ?? '').trim(); const clipId = String(input.clipId ?? '');
  const rawTags = String(input.hashtags ?? '').trim().split(/\s+/u).filter(Boolean);
  const tags = [...new Set(rawTags.map(tag => tag.replace(/^#+/u, '')))];
  const privacy = ['private', 'unlisted', 'public'].includes(String(input.privacy)) ? String(input.privacy) as 'private' | 'unlisted' | 'public' : 'private';
  if (!/^[0-9a-f-]{36}$/u.test(clipId) || !title || title.length > 100 || description.length > 5000) return Response.json({ error: 'Проверьте клип, заголовок и описание.' }, { status: 400 });
  if (tags.length > 15 || tags.some(tag => !/^[\p{L}\p{N}_-]{1,30}$/u.test(tag)) || tags.join(',').length > 450) return Response.json({ error: 'Хештеги: до 15 слов через пробел, без знаков кроме #, _ и -.' }, { status: 400 });
  let scheduledAt: string | null = null;
  if (input.scheduledAt) { const date = new Date(String(input.scheduledAt)); if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 60_000) return Response.json({ error: 'Время публикации должно быть в будущем.' }, { status: 400 }); scheduledAt = date.toISOString(); }
  try {
    const publication = createYouTubePublication({ userId: user.id, clipId, title, description, tags, privacy, scheduledAt });
    try { startYouTubePublicationWorker(publication.id); }
    catch (error) {
      updatePublication(publication.id, { status: 'failed', workerPid: null, error: error instanceof Error ? error.message : 'Не удалось запустить загрузку.' });
      throw error;
    }
    return Response.json({ publicationId: publication.id, status: 'queued' }, { status: 202 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Не удалось создать публикацию.' }, { status: 409 }); }
}
