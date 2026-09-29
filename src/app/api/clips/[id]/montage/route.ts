import { access, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/server/auth';
import { getOwnedClipForEdit, getOwnedProject, updateOwnedMontageClip } from '@/server/projects';
import { validateMontagePlan } from '@/lib/montage-plan-validation';
import { parseTranscriptArtifactV2, transcriptV2Segments } from '../../../../../../scripts/media/transcript-v2';
import { detectSubjectTrack } from '../../../../../../scripts/media/subject-tracking';
import { renderMontage } from '../../../../../../scripts/media/render-montage';
import type { Segment } from '../../../../../../scripts/media/core';
import type { MontagePlan } from '../../../../../../scripts/media/montage-plan';

export const runtime = 'nodejs';

async function load(id: string, ownerId: string) {
  if (!/^[0-9a-f-]{36}$/u.test(id)) return null;
  const row = getOwnedClipForEdit(id, ownerId);
  if (!row || row.project_kind !== 'montage') return null;
  const project = getOwnedProject(String(row.project_id), ownerId);
  if (!project || project.kind !== 'montage') return null;
  const directory = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects', project.id);
  let plan: MontagePlan | null = null;
  try { if (row.montage_plan) plan = JSON.parse(String(row.montage_plan)) as MontagePlan; } catch { /* legacy clip */ }
  if (!plan) {
    try {
      const saved = JSON.parse(await readFile(path.join(directory, 'approved-montage.json'), 'utf8')) as { plans?: MontagePlan[] };
      plan = saved.plans?.find(item => Math.abs(item.pieces[0].start - Number(row.start)) < 0.05) ?? null;
    } catch { /* no saved plan */ }
  }
  if (!plan || !Array.isArray(plan.pieces) || plan.pieces.length < 2) return null;
  plan = { ...plan, pieces: plan.pieces.map((piece, index) => ({ ...piece, sourceIndex: Number.isInteger(piece.sourceIndex) ? piece.sourceIndex : index, effect: piece.effect ?? 'none' })) };
  return { row, project, directory, plan };
}

async function loadTranscript(directory: string): Promise<Segment[]> {
  const v2 = path.join(directory, 'transcript-v2.json');
  if (await access(v2).then(() => true).catch(() => false)) return transcriptV2Segments(parseTranscriptArtifactV2(JSON.parse(await readFile(v2, 'utf8'))));
  const legacy = JSON.parse(await readFile(path.join(directory, 'transcript.json'), 'utf8')) as { segments?: Segment[] };
  if (!Array.isArray(legacy.segments)) throw new Error('Расшифровка проекта недоступна.');
  return legacy.segments;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const state = await load((await context.params).id, user.id);
  if (!state) return Response.json({ error: 'Монтажный клип или его план не найден.' }, { status: 404 });
  return Response.json({ plans: [state.plan] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const state = await load(id, user.id);
  if (!state) return Response.json({ error: 'Монтажный клип или его план не найден.' }, { status: 404 });
  if (state.project.status !== 'completed') return Response.json({ error: 'Дождитесь окончания обработки проекта.' }, { status: 409 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const choices = (body as { plans?: unknown })?.plans;
  if (!Array.isArray(choices) || choices.length !== 1 || (choices[0] as { index?: unknown })?.index !== 0) return Response.json({ error: 'Выберите один монтажный план.' }, { status: 400 });
  let plan: MontagePlan;
  try { plan = validateMontagePlan(state.plan, choices[0], state.project.analyzedDuration ?? 0); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Некорректный монтажный план.' }, { status: 400 }); }
  const oldVideo = String(state.row.video_path);
  const oldPreview = String(state.row.preview_path);
  let videoPath: string | null = null;
  try {
    const source = path.join(state.directory, 'source.mp4');
    const transcript = await loadTranscript(state.directory);
    const subjectTrack = state.project.autoReframe ? await detectSubjectTrack(source, state.directory, state.project.analyzedDuration ?? 0, state.project.processingMode) : [];
    videoPath = await renderMontage(source, path.dirname(oldVideo), plan, transcript, state.project, subjectTrack);
    const previewPath = videoPath.replace(/\.mp4$/u, '.jpg');
    const updated = updateOwnedMontageClip(id, user.id, { videoPath, previewPath, sizeBytes: (await stat(videoPath)).size, plan, renderedDuration: plan.totalDuration, start: plan.pieces[0].start, end: plan.pieces.at(-1)!.end });
    if (!updated) throw new Error('Клип был удалён во время рендера.');
    await Promise.allSettled([oldVideo, oldPreview].filter(file => file !== videoPath && file !== previewPath).map(file => rm(file, { force: true })));
    return Response.json({ ok: true });
  } catch (error) {
    if (videoPath) await Promise.all([videoPath, videoPath.replace(/\.mp4$/u, '.jpg')].map(file => rm(file, { force: true })));
    return Response.json({ error: error instanceof Error ? error.message : 'Не удалось перерендерить монтаж.' }, { status: 500 });
  }
}
