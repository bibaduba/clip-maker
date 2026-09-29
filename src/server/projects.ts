import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AdhdMainPosition, AspectRatio, CaptionStyle, ClipLength, FitBackground, ProcessingMode, ProjectClip, ProjectKind, ProjectRecord, ProjectStage } from '@/lib/project-types';

const storageRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage');
let database: DatabaseSync | undefined;
function getDb() {
  if (database) return database;
  mkdirSync(storageRoot, { recursive: true });
  const opened = new DatabaseSync(path.join(storageRoot, 'clip-maker.sqlite'));
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, video_id TEXT NOT NULL, source_url TEXT NOT NULL, title TEXT,
  status TEXT NOT NULL, subtitles INTEGER NOT NULL, subtitle_color TEXT NOT NULL,
  requested_clips INTEGER NOT NULL, source_duration REAL, analyzed_duration REAL,
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, reason TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL,
  subtitles INTEGER NOT NULL, video_path TEXT NOT NULL, preview_path TEXT NOT NULL,
  size_bytes INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_project_id ON clips(project_id);`);
  const projectColumns = opened.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
  if (!projectColumns.some(column => column.name === 'processing_mode')) opened.exec("ALTER TABLE projects ADD COLUMN processing_mode TEXT NOT NULL DEFAULT 'fast'");
  if (!projectColumns.some(column => column.name === 'worker_pid')) opened.exec('ALTER TABLE projects ADD COLUMN worker_pid INTEGER');
  if (!projectColumns.some(column => column.name === 'worker_heartbeat_at')) opened.exec('ALTER TABLE projects ADD COLUMN worker_heartbeat_at TEXT');
  if (!projectColumns.some(column => column.name === 'auto_reframe')) opened.exec('ALTER TABLE projects ADD COLUMN auto_reframe INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'owner_id')) opened.exec('ALTER TABLE projects ADD COLUMN owner_id TEXT');
  if (!projectColumns.some(column => column.name === 'aspect_ratio')) opened.exec("ALTER TABLE projects ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '9:16'");
  if (!projectColumns.some(column => column.name === 'clip_length')) opened.exec("ALTER TABLE projects ADD COLUMN clip_length TEXT NOT NULL DEFAULT 'medium'");
  if (!projectColumns.some(column => column.name === 'caption_style')) opened.exec("ALTER TABLE projects ADD COLUMN caption_style TEXT NOT NULL DEFAULT 'modern'");
  if (!projectColumns.some(column => column.name === 'word_highlight')) opened.exec('ALTER TABLE projects ADD COLUMN word_highlight INTEGER NOT NULL DEFAULT 1');
  if (!projectColumns.some(column => column.name === 'highlight_keywords')) opened.exec('ALTER TABLE projects ADD COLUMN highlight_keywords INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'add_emojis')) opened.exec('ALTER TABLE projects ADD COLUMN add_emojis INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'auto_censor')) opened.exec('ALTER TABLE projects ADD COLUMN auto_censor INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'clip_prompt')) opened.exec('ALTER TABLE projects ADD COLUMN clip_prompt TEXT');
  if (!projectColumns.some(column => column.name === 'fit_background')) opened.exec("ALTER TABLE projects ADD COLUMN fit_background TEXT NOT NULL DEFAULT 'black'");
  if (!projectColumns.some(column => column.name === 'add_broll')) opened.exec('ALTER TABLE projects ADD COLUMN add_broll INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'adhd_mode')) opened.exec('ALTER TABLE projects ADD COLUMN adhd_mode INTEGER NOT NULL DEFAULT 0');
  if (!projectColumns.some(column => column.name === 'adhd_gameplay')) opened.exec('ALTER TABLE projects ADD COLUMN adhd_gameplay TEXT');
  if (!projectColumns.some(column => column.name === 'adhd_main_position')) opened.exec("ALTER TABLE projects ADD COLUMN adhd_main_position TEXT NOT NULL DEFAULT 'center'");
  if (!projectColumns.some(column => column.name === 'kind')) opened.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'clips'");
  // Processing profiles were removed from the UI; use the workstation profile
  // for both new and existing projects.
  opened.exec("UPDATE projects SET processing_mode = 'fast' WHERE processing_mode = 'eco'");
  const clipColumns = opened.prepare('PRAGMA table_info(clips)').all() as Array<{ name: string }>;
  if (!clipColumns.some(column => column.name === 'size_bytes')) opened.exec('ALTER TABLE clips ADD COLUMN size_bytes INTEGER');
  if (!clipColumns.some(column => column.name === 'query_match')) opened.exec('ALTER TABLE clips ADD COLUMN query_match INTEGER');
  if (!clipColumns.some(column => column.name === 'subtitle_text')) opened.exec('ALTER TABLE clips ADD COLUMN subtitle_text TEXT');
  if (!clipColumns.some(column => column.name === 'caption_style')) opened.exec('ALTER TABLE clips ADD COLUMN caption_style TEXT');
  if (!clipColumns.some(column => column.name === 'subtitle_color')) opened.exec('ALTER TABLE clips ADD COLUMN subtitle_color TEXT');
  if (!clipColumns.some(column => column.name === 'word_highlight')) opened.exec('ALTER TABLE clips ADD COLUMN word_highlight INTEGER');
  if (!clipColumns.some(column => column.name === 'highlight_keywords')) opened.exec('ALTER TABLE clips ADD COLUMN highlight_keywords INTEGER');
  if (!clipColumns.some(column => column.name === 'add_emojis')) opened.exec('ALTER TABLE clips ADD COLUMN add_emojis INTEGER');
  if (!clipColumns.some(column => column.name === 'auto_censor')) opened.exec('ALTER TABLE clips ADD COLUMN auto_censor INTEGER');
  if (!clipColumns.some(column => column.name === 'reframe_offset')) opened.exec('ALTER TABLE clips ADD COLUMN reframe_offset REAL NOT NULL DEFAULT 0');
  if (!clipColumns.some(column => column.name === 'viral_potential')) opened.exec('ALTER TABLE clips ADD COLUMN viral_potential INTEGER');
  if (!clipColumns.some(column => column.name === 'hook_score')) opened.exec('ALTER TABLE clips ADD COLUMN hook_score INTEGER');
  if (!clipColumns.some(column => column.name === 'completeness_score')) opened.exec('ALTER TABLE clips ADD COLUMN completeness_score INTEGER');
  if (!clipColumns.some(column => column.name === 'value_score')) opened.exec('ALTER TABLE clips ADD COLUMN value_score INTEGER');
  if (!clipColumns.some(column => column.name === 'broll_sources')) opened.exec("ALTER TABLE clips ADD COLUMN broll_sources TEXT NOT NULL DEFAULT '[]'");
  if (!clipColumns.some(column => column.name === 'broll_error')) opened.exec('ALTER TABLE clips ADD COLUMN broll_error TEXT');
  if (!clipColumns.some(column => column.name === 'series_key')) opened.exec('ALTER TABLE clips ADD COLUMN series_key TEXT');
  if (!clipColumns.some(column => column.name === 'series_part')) opened.exec('ALTER TABLE clips ADD COLUMN series_part INTEGER');
  if (!clipColumns.some(column => column.name === 'series_total')) opened.exec('ALTER TABLE clips ADD COLUMN series_total INTEGER');
  if (!clipColumns.some(column => column.name === 'favorite')) opened.exec('ALTER TABLE clips ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  if (!clipColumns.some(column => column.name === 'manual_crop')) opened.exec('ALTER TABLE clips ADD COLUMN manual_crop TEXT');
  if (!clipColumns.some(column => column.name === 'text_overlays')) opened.exec("ALTER TABLE clips ADD COLUMN text_overlays TEXT NOT NULL DEFAULT '[]'");
  if (!clipColumns.some(column => column.name === 'not_interesting')) opened.exec('ALTER TABLE clips ADD COLUMN not_interesting INTEGER NOT NULL DEFAULT 0');
  if (!clipColumns.some(column => column.name === 'cut_segments')) opened.exec("ALTER TABLE clips ADD COLUMN cut_segments TEXT NOT NULL DEFAULT '[]'");
  if (!clipColumns.some(column => column.name === 'rendered_duration')) opened.exec('ALTER TABLE clips ADD COLUMN rendered_duration REAL');
  if (!clipColumns.some(column => column.name === 'montage_plan')) opened.exec('ALTER TABLE clips ADD COLUMN montage_plan TEXT');
  database = opened;
  return opened;
}

type Row = Record<string, unknown>;
function hydrate(row: Row): ProjectRecord {
  const clips = getDb().prepare('SELECT id, project_id, title, reason, query_match, viral_potential, hook_score, completeness_score, value_score, start, end, rendered_duration, subtitles, size_bytes, created_at, broll_sources, broll_error, series_key, series_part, series_total, favorite, not_interesting FROM clips WHERE project_id = ? ORDER BY created_at').all(String(row.id)) as Row[];
  return {
    id: String(row.id), kind: String(row.kind ?? 'clips') as ProjectKind, videoId: String(row.video_id), sourceUrl: String(row.source_url), title: row.title ? String(row.title) : null,
    status: String(row.status) as ProjectStage, subtitles: Boolean(row.subtitles), subtitleColor: String(row.subtitle_color), requestedClips: Number(row.requested_clips), processingMode: 'fast', autoReframe: Boolean(row.auto_reframe), aspectRatio: String(row.aspect_ratio ?? '9:16') as AspectRatio, clipLength: String(row.clip_length ?? 'medium') as ClipLength, captionStyle: String(row.caption_style ?? 'modern') as CaptionStyle, wordHighlight: Boolean(row.word_highlight ?? 1), highlightKeywords: Boolean(row.highlight_keywords), addEmojis: Boolean(row.add_emojis), autoCensor: Boolean(row.auto_censor), clipPrompt: row.clip_prompt ? String(row.clip_prompt) : null, fitBackground: String(row.fit_background ?? 'black') as FitBackground, addBroll: Boolean(row.add_broll), adhdMode: Boolean(row.adhd_mode), adhdGameplay: row.adhd_gameplay ? String(row.adhd_gameplay) : null, adhdMainPosition: String(row.adhd_main_position ?? 'center') as AdhdMainPosition,
    sourceDuration: row.source_duration == null ? null : Number(row.source_duration), analyzedDuration: row.analyzed_duration == null ? null : Number(row.analyzed_duration),
    error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    clips: clips.map(clip => {
      let brollSources: ProjectClip['brollSources'] = [];
      try { const parsed = JSON.parse(String(clip.broll_sources ?? '[]')); if (Array.isArray(parsed)) brollSources = parsed; } catch { /* Old or damaged metadata must not hide a clip. */ }
      return { id: String(clip.id), projectId: String(clip.project_id), title: String(clip.title), reason: String(clip.reason), queryMatch: clip.query_match == null ? null : Number(clip.query_match), viralPotential: clip.viral_potential == null ? null : Number(clip.viral_potential), hookScore: clip.hook_score == null ? null : Number(clip.hook_score), completenessScore: clip.completeness_score == null ? null : Number(clip.completeness_score), valueScore: clip.value_score == null ? null : Number(clip.value_score), start: Number(clip.start), end: Number(clip.end), renderedDuration: clip.rendered_duration == null ? null : Number(clip.rendered_duration), subtitles: Boolean(clip.subtitles), sizeBytes: clip.size_bytes == null ? null : Number(clip.size_bytes), createdAt: String(clip.created_at), brollSources, brollError: clip.broll_error ? String(clip.broll_error) : null, seriesKey: clip.series_key ? String(clip.series_key) : null, seriesPart: clip.series_part == null ? null : Number(clip.series_part), seriesTotal: clip.series_total == null ? null : Number(clip.series_total), favorite: Boolean(clip.favorite), notInteresting: Boolean(clip.not_interesting) };
    }),
  };
}

export function createProject(input: { id: string; ownerId: string; videoId: string; sourceUrl: string; kind?: ProjectKind; subtitles: boolean; subtitleColor: string; requestedClips: number; processingMode: ProcessingMode; autoReframe: boolean; aspectRatio: AspectRatio; clipLength: ClipLength; captionStyle: CaptionStyle; wordHighlight: boolean; highlightKeywords: boolean; addEmojis: boolean; autoCensor: boolean; clipPrompt: string | null; fitBackground: FitBackground; addBroll: boolean; adhdMode: boolean; adhdGameplay: string | null; adhdMainPosition: AdhdMainPosition }) {
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO projects (id, owner_id, video_id, source_url, status, subtitles, subtitle_color, requested_clips, processing_mode, auto_reframe, aspect_ratio, clip_length, caption_style, word_highlight, highlight_keywords, add_emojis, auto_censor, clip_prompt, fit_background, add_broll, adhd_mode, adhd_gameplay, adhd_main_position, created_at, updated_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(input.id, input.ownerId, input.videoId, input.sourceUrl, 'queued', Number(input.subtitles), input.subtitleColor, input.requestedClips, input.processingMode, Number(input.autoReframe), input.aspectRatio, input.clipLength, input.captionStyle, Number(input.wordHighlight), Number(input.highlightKeywords), Number(input.addEmojis), Number(input.autoCensor), input.clipPrompt, input.fitBackground, Number(input.addBroll), Number(input.adhdMode), input.adhdGameplay, input.adhdMainPosition, now, now, input.kind ?? 'clips');
  return getProject(input.id)!;
}
export function getProject(id: string) { const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined; return row ? hydrate(row) : null; }
export function getOwnedProject(id: string, ownerId: string) { const row = getDb().prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(id, ownerId) as Row | undefined; return row ? hydrate(row) : null; }
export function listProjects(ownerId: string, limit = 20, kind?: ProjectKind) {
  const max = Math.min(Math.max(limit, 1), 100);
  const rows = kind
    ? getDb().prepare('SELECT * FROM projects WHERE owner_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?').all(ownerId, kind, max)
    : getDb().prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?').all(ownerId, max);
  return (rows as Row[]).map(hydrate);
}
export function listOwnedStorageRecords(ownerId: string) {
  const projects = getDb().prepare('SELECT id, status, updated_at FROM projects WHERE owner_id = ?').all(ownerId) as Row[];
  return projects.map(project => ({
    id: String(project.id), status: String(project.status) as ProjectStage, updatedAt: String(project.updated_at),
    protectedFiles: (getDb().prepare('SELECT video_path, preview_path FROM clips WHERE project_id = ?').all(String(project.id)) as Row[]).flatMap(clip => [String(clip.video_path), String(clip.preview_path)]),
  }));
}
export function hasActiveProject(ownerId?: string) {
  const row = ownerId
    ? getDb().prepare("SELECT 1 active FROM projects WHERE owner_id = ? AND status IN ('queued','metadata','downloading','transcribing','selecting','rendering','cancelling') LIMIT 1").get(ownerId) as Row | undefined
    : getDb().prepare("SELECT 1 active FROM projects WHERE status IN ('queued','metadata','downloading','transcribing','selecting','rendering','cancelling') LIMIT 1").get() as Row | undefined;
  return Boolean(row);
}
export function claimNextQueuedProject() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const active = db.prepare("SELECT 1 active FROM projects WHERE status IN ('metadata','downloading','transcribing','selecting','rendering','cancelling') OR (status = 'queued' AND worker_pid IS NOT NULL) LIMIT 1").get() as Row | undefined;
    if (active) { db.exec('COMMIT'); return null; }
    const row = db.prepare("SELECT id FROM projects WHERE status = 'queued' AND worker_pid IS NULL ORDER BY created_at ASC LIMIT 1").get() as Row | undefined;
    if (!row) { db.exec('COMMIT'); return null; }
    const id = String(row.id);
    db.prepare('UPDATE projects SET worker_pid = -1, updated_at = ? WHERE id = ? AND status = ? AND worker_pid IS NULL').run(new Date().toISOString(), id, 'queued');
    db.exec('COMMIT');
    return getProject(id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function recoverInterruptedProjects() {
  const rows = getDb().prepare("SELECT id, status, worker_pid, worker_heartbeat_at FROM projects WHERE status IN ('queued','metadata','downloading','transcribing','selecting','rendering','cancelling') AND worker_pid IS NOT NULL").all() as Row[];
  const recovered: string[] = [];
  for (const row of rows) {
    const pid = Number(row.worker_pid);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; }
      catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM'; }
    }
    const heartbeatAge = row.worker_heartbeat_at ? Date.now() - Date.parse(String(row.worker_heartbeat_at)) : Number.POSITIVE_INFINITY;
    // Workers started before heartbeat support are trusted while their PID is alive.
    if (alive && (!row.worker_heartbeat_at || heartbeatAge < 45_000)) continue;
    const status = String(row.status) as ProjectStage;
    const nextStatus: ProjectStage = status === 'cancelling' ? 'cancelled' : 'queued';
    getDb().prepare('UPDATE projects SET status = ?, worker_pid = NULL, worker_heartbeat_at = NULL, error = ?, updated_at = ? WHERE id = ? AND worker_pid = ?').run(nextStatus, nextStatus === 'queued' ? 'Обработка была прервана перезапуском и автоматически возвращена в очередь.' : null, new Date().toISOString(), String(row.id), row.worker_pid);
    recovered.push(String(row.id));
  }
  return recovered;
}
export function updateProject(id: string, changes: Partial<{ status: ProjectStage; title: string; sourceDuration: number; analyzedDuration: number; requestedClips: number; error: string | null; workerPid: number | null; workerHeartbeatAt: string | null }>) {
  const columns: Record<string, string> = { status: 'status', title: 'title', sourceDuration: 'source_duration', analyzedDuration: 'analyzed_duration', requestedClips: 'requested_clips', error: 'error', workerPid: 'worker_pid', workerHeartbeatAt: 'worker_heartbeat_at' };
  const entries = Object.entries(changes).filter(([key]) => key in columns);
  if (!entries.length) return;
  const set = entries.map(([key]) => `${columns[key]} = ?`).concat('updated_at = ?').join(', ');
  getDb().prepare(`UPDATE projects SET ${set} WHERE id = ?`).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
}
export function getProjectWorkerPid(id: string) {
  const row = getDb().prepare('SELECT worker_pid FROM projects WHERE id = ?').get(id) as Row | undefined;
  return Number.isInteger(row?.worker_pid) && Number(row?.worker_pid) > 0 ? Number(row?.worker_pid) : null;
}
export function addClip(clip: ProjectClip & { videoPath: string; previewPath: string; montagePlan?: unknown }) {
  getDb().prepare('INSERT INTO clips (id, project_id, title, reason, query_match, viral_potential, hook_score, completeness_score, value_score, start, end, rendered_duration, subtitles, video_path, preview_path, size_bytes, created_at, broll_sources, broll_error, series_key, series_part, series_total, montage_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(clip.id, clip.projectId, clip.title, clip.reason, clip.queryMatch, clip.viralPotential, clip.hookScore, clip.completenessScore, clip.valueScore, clip.start, clip.end, clip.renderedDuration ?? null, Number(clip.subtitles), clip.videoPath, clip.previewPath, clip.sizeBytes, clip.createdAt, JSON.stringify(clip.brollSources), clip.brollError, clip.seriesKey, clip.seriesPart, clip.seriesTotal, clip.montagePlan ? JSON.stringify(clip.montagePlan) : null);
}

export function updateOwnedMontageClip(id: string, ownerId: string, input: { videoPath: string; previewPath: string; sizeBytes: number; plan: unknown; renderedDuration: number; start: number; end: number }) {
  return getDb().prepare("UPDATE clips SET video_path = ?, preview_path = ?, size_bytes = ?, montage_plan = ?, rendered_duration = ?, start = ?, end = ? WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ? AND kind = 'montage')").run(input.videoPath, input.previewPath, input.sizeBytes, JSON.stringify(input.plan), input.renderedDuration, input.start, input.end, id, ownerId).changes > 0;
}
export function setOwnedClipFavorite(id: string, ownerId: string, favorite: boolean) {
  const clip = getDb().prepare('SELECT c.id FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?').get(id, ownerId) as Row | undefined;
  if (!clip) return false;
  getDb().prepare('UPDATE clips SET favorite = ?, not_interesting = CASE WHEN ? = 1 THEN 0 ELSE not_interesting END WHERE id = ?').run(Number(favorite), Number(favorite), id);
  return true;
}
export function setOwnedClipNotInteresting(id: string, ownerId: string, notInteresting: boolean) {
  const clip = getDb().prepare('SELECT c.id FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?').get(id, ownerId) as Row | undefined;
  if (!clip) return false;
  getDb().prepare('UPDATE clips SET not_interesting = ?, favorite = CASE WHEN ? = 1 THEN 0 ELSE favorite END WHERE id = ?').run(Number(notInteresting), Number(notInteresting), id);
  return true;
}
export function getSelectionPreferencesForProject(projectId: string) {
  const project = getDb().prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId) as Row | undefined;
  if (!project?.owner_id) return { positive: [], negative: [] };
  const rows = getDb().prepare(`SELECT c.title, c.reason, c.favorite, c.not_interesting FROM clips c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ? AND (c.favorite = 1 OR c.not_interesting = 1) ORDER BY c.created_at DESC LIMIT 40`).all(String(project.owner_id)) as Row[];
  const describe = (row: Row) => `${String(row.title).slice(0, 100)} — ${String(row.reason).slice(0, 240)}`;
  return { positive: rows.filter(row => Boolean(row.favorite)).map(describe).slice(0, 20), negative: rows.filter(row => Boolean(row.not_interesting)).map(describe).slice(0, 20) };
}
export function listOwnedFavoriteClips(ownerId: string) {
  return getDb().prepare(`SELECT c.id, c.project_id, c.title, c.reason, c.start, c.end, c.size_bytes, c.created_at, c.series_part, c.series_total, p.title project_title, p.aspect_ratio FROM clips c JOIN projects p ON p.id = c.project_id WHERE p.owner_id = ? AND c.favorite = 1 ORDER BY c.created_at DESC`).all(ownerId) as Row[];
}
export function getClipAsset(id: string, asset: 'video' | 'preview', ownerId: string) {
  const row = getDb().prepare(`SELECT c.${asset === 'video' ? 'video_path' : 'preview_path'} path FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?`).get(id, ownerId) as Row | undefined;
  return row?.path ? String(row.path) : null;
}
export function getOwnedClipSource(id: string, ownerId: string) {
  const row = getDb().prepare('SELECT p.id FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?').get(id, ownerId) as Row | undefined;
  return row ? path.join(storageRoot, 'projects', String(row.id), 'source.mp4') : null;
}
export function getOwnedClipForEdit(id: string, ownerId: string) {
  return getDb().prepare(`SELECT c.*, p.kind project_kind, p.aspect_ratio, p.fit_background, p.processing_mode, p.auto_reframe, p.adhd_mode, p.adhd_gameplay, p.adhd_main_position, p.caption_style project_caption_style, p.subtitle_color project_subtitle_color, p.word_highlight project_word_highlight, p.highlight_keywords project_highlight_keywords, p.add_emojis project_add_emojis, p.auto_censor project_auto_censor FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?`).get(id, ownerId) as Row | undefined;
}
export function updateOwnedClipRender(id: string, ownerId: string, input: { videoPath: string; previewPath: string; sizeBytes: number; subtitles: boolean; subtitleText: string; captionStyle: CaptionStyle; subtitleColor: string; wordHighlight: boolean; highlightKeywords: boolean; addEmojis: boolean; autoCensor: boolean; reframeOffset: number; manualCrop: unknown; textOverlays: unknown[]; cutSegments: number[] }) {
  getDb().prepare(`UPDATE clips SET video_path = ?, preview_path = ?, size_bytes = ?, subtitles = ?, subtitle_text = ?, caption_style = ?, subtitle_color = ?, word_highlight = ?, highlight_keywords = ?, add_emojis = ?, auto_censor = ?, reframe_offset = ?, manual_crop = ?, text_overlays = ?, cut_segments = ? WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)`).run(input.videoPath, input.previewPath, input.sizeBytes, Number(input.subtitles), input.subtitleText, input.captionStyle, input.subtitleColor, Number(input.wordHighlight), Number(input.highlightKeywords), Number(input.addEmojis), Number(input.autoCensor), input.reframeOffset, input.manualCrop ? JSON.stringify(input.manualCrop) : null, JSON.stringify(input.textOverlays), JSON.stringify(input.cutSegments), id, ownerId);
}
export function deleteOwnedClip(id: string, ownerId: string) {
  const row = getDb().prepare('SELECT c.video_path, c.preview_path FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?').get(id, ownerId) as Row | undefined;
  if (!row) return null;
  getDb().prepare('DELETE FROM clips WHERE id = ?').run(id);
  return { videoPath: String(row.video_path), previewPath: String(row.preview_path) };
}
export function deleteOwnedProject(id: string, ownerId: string) {
  const row = getDb().prepare('SELECT id, status FROM projects WHERE id = ? AND owner_id = ?').get(id, ownerId) as Row | undefined;
  if (!row) return null;
  const clips = getDb().prepare('SELECT video_path, preview_path FROM clips WHERE project_id = ?').all(id) as Row[];
  getDb().exec('BEGIN IMMEDIATE');
  try {
    getDb().prepare('DELETE FROM clips WHERE project_id = ?').run(id);
    getDb().prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(id, ownerId);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
  return { status: String(row.status) as ProjectStage, files: clips.flatMap(clip => [String(clip.video_path), String(clip.preview_path)]) };
}

export function resetOwnedProjectForRegeneration(id: string, ownerId: string, preserveCompletedClips = false) {
  const row = getDb().prepare('SELECT id, status FROM projects WHERE id = ? AND owner_id = ?').get(id, ownerId) as Row | undefined;
  if (!row) return null;
  const clips = getDb().prepare('SELECT video_path, preview_path FROM clips WHERE project_id = ?').all(id) as Row[];
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!preserveCompletedClips) db.prepare('DELETE FROM clips WHERE project_id = ?').run(id);
    db.prepare("UPDATE projects SET status = 'queued', error = NULL, worker_pid = NULL, worker_heartbeat_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?").run(new Date().toISOString(), id, ownerId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { project: getOwnedProject(id, ownerId)!, files: preserveCompletedClips ? [] : clips.flatMap(clip => [String(clip.video_path), String(clip.preview_path)]) };
}
