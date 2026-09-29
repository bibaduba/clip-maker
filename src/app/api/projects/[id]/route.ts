import { rm } from 'node:fs/promises';
import path from 'node:path';
import { deleteOwnedProject, getOwnedProject, getProjectWorkerPid, resetOwnedProjectForRegeneration } from '@/server/projects';
import { startNextQueuedProject } from '@/server/start-worker';
import { currentUser } from '@/server/auth';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  startNextQueuedProject();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: 'Проект не найден.' }, { status: 404 });
  const project = getOwnedProject(id, user.id);
  return project ? Response.json({ project }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Проект не найден.' }, { status: 404 });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const project = /^[0-9a-f-]{36}$/.test(id) ? getOwnedProject(id, user.id) : null;
  if (!project) return Response.json({ error: 'Проект не найден.' }, { status: 404 });
  if (!['completed', 'failed', 'cancelled'].includes(project.status)) return Response.json({ error: 'Дождитесь окончания обработки или остановите её.' }, { status: 409 });
  if (getProjectWorkerPid(id)) return Response.json({ error: 'Обработка проекта ещё не остановлена.' }, { status: 409 });
  const reset = resetOwnedProjectForRegeneration(id, user.id, project.status === 'failed');
  if (!reset) return Response.json({ error: 'Проект не найден.' }, { status: 404 });
  const root = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects') + path.sep;
  const directories = new Set(reset.files.map(file => path.dirname(file)));
  await Promise.all([...directories].map(directory => {
    const resolved = path.resolve(directory);
    return resolved.startsWith(root) ? rm(resolved, { recursive: true, force: true }) : Promise.resolve();
  }));
  if (project.status === 'completed') await Promise.all(['approved-selection.json', 'approved-montage.json'].map(file => rm(path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects', id, file), { force: true })));
  startNextQueuedProject();
  return Response.json({ project: reset.project });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const project = /^[0-9a-f-]{36}$/.test(id) ? getOwnedProject(id, user.id) : null;
  if (!project) return Response.json({ error: 'Проект не найден.' }, { status: 404 });
  if (getProjectWorkerPid(id) || !['completed', 'failed', 'cancelled', 'review'].includes(project.status)) return Response.json({ error: 'Сначала остановите обработку проекта.' }, { status: 409 });
  deleteOwnedProject(id, user.id);
  const root = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects');
  const directory = path.resolve(root, id);
  if (directory.startsWith(root + path.sep)) await rm(directory, { recursive: true, force: true });
  return new Response(null, { status: 204 });
}
