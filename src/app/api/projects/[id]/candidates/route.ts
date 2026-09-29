import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/server/auth';
import { getOwnedProject, updateProject } from '@/server/projects';
import { startNextQueuedProject } from '@/server/start-worker';
import { clipLengthRanges } from '@/lib/project-types';
import type { ClipCandidate } from '../../../../../../scripts/media/selection';

export const runtime = 'nodejs';

type Selection = {
  selectionVersion: number;
  preferenceFingerprint: string;
  requestedClips: number;
  candidates: ClipCandidate[];
};

async function load(id: string, ownerId: string) {
  if (!/^[0-9a-f-]{36}$/u.test(id)) return null;
  const project = getOwnedProject(id, ownerId);
  if (!project || project.status !== 'review') return null;
  const directory = path.resolve('storage/projects', id);
  try {
    const selection = JSON.parse(await readFile(path.join(directory, 'selection.json'), 'utf8')) as Selection;
    if (!Array.isArray(selection.candidates) || !selection.candidates.length) return null;
    return { project, directory, selection };
  } catch { return null; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const state = await load((await context.params).id, user.id);
  if (!state) return Response.json({ error: 'Моменты пока недоступны.' }, { status: 404 });
  return Response.json({ candidates: state.selection.candidates.map((candidate, index) => ({ ...candidate, index })), limit: state.selection.requestedClips, duration: state.project.analyzedDuration }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const state = await load(id, user.id);
  if (!state) return Response.json({ error: 'Проект не ожидает выбора моментов.' }, { status: 409 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || !choices.length || choices.length > state.selection.requestedClips)
    return Response.json({ error: `Выберите от 1 до ${state.selection.requestedClips} моментов.` }, { status: 400 });
  const used = new Set<number>();
  const candidates: ClipCandidate[] = [];
  const { min, max } = clipLengthRanges[state.project.clipLength];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') return Response.json({ error: 'Некорректный момент.' }, { status: 400 });
    const { index, start, end } = choice as { index?: number; start?: number; end?: number };
    if (!Number.isInteger(index) || index! < 0 || index! >= state.selection.candidates.length || used.has(index!))
      return Response.json({ error: 'Некорректный или повторяющийся момент.' }, { status: 400 });
    const original = state.selection.candidates[index!];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start! < 0 || end! > (state.project.analyzedDuration ?? 0) + 0.1 ||
        Math.abs(start! - original.start) > 20 || Math.abs(end! - original.end) > 20 || end! - start! < min || end! - start! > max)
      return Response.json({ error: 'Границы момента выходят за допустимый диапазон.' }, { status: 400 });
    used.add(index!);
    candidates.push({ ...original, start: start!, end: end! });
  }
  if (candidates.some((candidate, index) => candidates.slice(index + 1).some(other => candidate.start < other.end && candidate.end > other.start)))
    return Response.json({ error: 'Выбранные моменты пересекаются. Оставьте один из них.' }, { status: 400 });
  await writeFile(path.join(state.directory, 'approved-selection.json'), JSON.stringify({ selectionVersion: state.selection.selectionVersion, preferenceFingerprint: state.selection.preferenceFingerprint, candidates }, null, 2));
  updateProject(id, { status: 'queued', workerPid: null, workerHeartbeatAt: null, error: null });
  startNextQueuedProject();
  return Response.json({ project: getOwnedProject(id, user.id) });
}
