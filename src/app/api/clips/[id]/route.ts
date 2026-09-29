import { rm } from 'node:fs/promises';
import path from 'node:path';
import { deleteOwnedClip, setOwnedClipFavorite, setOwnedClipNotInteresting } from '@/server/projects';
import { currentUser } from '@/server/auth';

export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/u.test(id)) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;
  const hasFavorite = typeof input.favorite === 'boolean';
  const hasNotInteresting = typeof input.notInteresting === 'boolean';
  if (!hasFavorite && !hasNotInteresting) return Response.json({ error: 'Некорректная реакция на клип.' }, { status: 400 });
  if (input.favorite === true && input.notInteresting === true) return Response.json({ error: 'Клип не может одновременно нравиться и быть неинтересным.' }, { status: 400 });
  if (hasFavorite && !setOwnedClipFavorite(id, user.id, Boolean(input.favorite))) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  if (hasNotInteresting && !setOwnedClipNotInteresting(id, user.id, Boolean(input.notInteresting))) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  return Response.json({ ...(hasFavorite ? { favorite: Boolean(input.favorite), ...(input.favorite ? { notInteresting: false } : {}) } : {}), ...(hasNotInteresting ? { notInteresting: Boolean(input.notInteresting), ...(input.notInteresting ? { favorite: false } : {}) } : {}) });
}
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  const files = deleteOwnedClip(id, user.id);
  if (!files) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  const root = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects') + path.sep;
  const directories = new Set([path.dirname(files.videoPath), path.dirname(files.previewPath)]);
  await Promise.all([...directories].map(directory => {
    const resolved = path.resolve(directory);
    return resolved.startsWith(root) ? rm(resolved, { recursive: true, force: true }) : Promise.resolve();
  }));
  return new Response(null, { status: 204 });
}
