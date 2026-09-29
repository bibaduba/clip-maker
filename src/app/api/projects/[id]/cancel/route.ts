import { getProject, getOwnedProject, getProjectWorkerPid, updateProject } from '@/server/projects';
import { currentUser } from '@/server/auth';
import { startNextQueuedProject, stopProjectWorker } from '@/server/start-worker';

export const runtime = 'nodejs';
const cancellable = new Set(['queued', 'metadata', 'downloading', 'transcribing', 'selecting', 'rendering']);

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const project = /^[0-9a-f-]{36}$/.test(id) ? getOwnedProject(id, user.id) : null;
  if (!project) return Response.json({ error: 'Проект не найден.' }, { status: 404 });
  if (!cancellable.has(project.status)) return Response.json({ error: 'Этот проект уже не обрабатывается.' }, { status: 409 });
  const pid = getProjectWorkerPid(id);
  updateProject(id, { status: 'cancelling', error: null });
  if (!pid) {
    updateProject(id, { status: 'cancelled', workerPid: null });
    startNextQueuedProject();
    return Response.json({ project: getOwnedProject(id, user.id) });
  }
  try {
    stopProjectWorker(pid);
    const forceTimer = setTimeout(() => {
      if (getProject(id)?.status !== 'cancelling') return;
      try { stopProjectWorker(pid, true); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
      updateProject(id, { status: 'cancelled', workerPid: null });
      startNextQueuedProject();
    }, 8_000);
    forceTimer.unref();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      updateProject(id, { status: project.status });
      return Response.json({ error: 'Не удалось остановить обработку.' }, { status: 500 });
    }
    updateProject(id, { status: 'cancelled', workerPid: null });
    startNextQueuedProject();
  }
  return Response.json({ project: getOwnedProject(id, user.id) });
}
