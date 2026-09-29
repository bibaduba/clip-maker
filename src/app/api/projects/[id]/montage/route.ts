import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/server/auth';
import { getOwnedProject, updateProject } from '@/server/projects';
import { startNextQueuedProject } from '@/server/start-worker';
import type { MontagePlan } from '../../../../../../scripts/media/montage-plan';
import { validateMontagePlan } from '@/lib/montage-plan-validation';

export const runtime = 'nodejs';
type Stored = { selectionVersion: number; preferenceFingerprint: string; plans: MontagePlan[] };

async function load(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/u.test(id)) return null;
  const project = getOwnedProject(id, userId);
  if (!project || project.kind !== 'montage' || project.status !== 'review') return null;
  const directory = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects', id);
  try {
    const stored = JSON.parse(await readFile(path.join(directory, 'montage-plan.json'), 'utf8')) as Stored;
    if (!Array.isArray(stored.plans) || !stored.plans.length) return null;
    stored.plans = stored.plans.map(plan => ({ ...plan, pieces: plan.pieces.map((piece, index) => ({ ...piece, sourceIndex: index, effect: ['none', 'punch', 'flash', 'freeze', 'arrow'].includes(piece.effect) ? piece.effect : 'none' })) }));
    return { project, directory, stored };
  } catch { return null; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const state = await load((await context.params).id, user.id);
  if (!state) return Response.json({ error: 'Монтажный план недоступен.' }, { status: 404 });
  return Response.json({ plans: state.stored.plans }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const state = await load(id, user.id);
  if (!state) return Response.json({ error: 'Проект не ожидает утверждения плана.' }, { status: 409 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const choices = (body as { plans?: unknown })?.plans;
  if (!Array.isArray(choices) || !choices.length || choices.length > state.stored.plans.length) return Response.json({ error: 'Выберите хотя бы один план.' }, { status: 400 });
  const approved: MontagePlan[] = [];
  const used = new Set<number>();
  for (const value of choices) {
    if (!value || typeof value !== 'object') return Response.json({ error: 'Некорректный план.' }, { status: 400 });
    const item = value as { index?: number; pieces?: unknown };
    if (!Number.isInteger(item.index) || item.index! < 0 || item.index! >= state.stored.plans.length || used.has(item.index!)) return Response.json({ error: 'Некорректный номер плана.' }, { status: 400 });
    used.add(item.index!);
    try { approved.push(validateMontagePlan(state.stored.plans[item.index!], item, state.project.analyzedDuration ?? 0)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Некорректный монтажный план.' }, { status: 400 }); }
  }
  await writeFile(path.join(state.directory, 'approved-montage.json'), JSON.stringify({ selectionVersion: state.stored.selectionVersion, preferenceFingerprint: state.stored.preferenceFingerprint, plans: approved }, null, 2));
  updateProject(id, { status: 'queued', workerPid: null, workerHeartbeatAt: null, error: null });
  startNextQueuedProject();
  return Response.json({ project: getOwnedProject(id, user.id) });
}
