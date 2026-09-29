import { access, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/server/auth';
import { getOwnedClipForEdit, updateOwnedClipRender } from '@/server/projects';
import { ASPECT_RATIOS, CAPTION_STYLES, type AspectRatio, type CaptionStyle } from '@/lib/project-types';
import { renderClip, type ManualCrop, type SubjectPoint, type TextOverlay } from '../../../../../../scripts/media/render';
import { applyAdhdGameplay } from '../../../../../../scripts/media/adhd-render';
import { parseTranscriptArtifactV2, transcriptV2Segments } from '../../../../../../scripts/media/transcript-v2';
import type { Segment, TimedToken } from '../../../../../../scripts/media/core';
import { resolveGameplayVideo } from '@/server/gameplay';
import { cutRenderedClip } from '../../../../../../scripts/media/cut-intervals';

export const runtime = 'nodejs';
const allowedColors = new Set(['#ffd400', '#28c76f', '#43a5ff', '#ffffff']);
const overlayFonts = new Set<TextOverlay['fontFamily']>(['Montserrat', 'Russo One', 'Arial', 'Bahnschrift']);
const hexColor = /^#[0-9a-f]{6}$/iu;

function storedJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function validCrop(value: unknown): ManualCrop | null {
  if (value == null) return null;
  const crop = value as Record<string, unknown>;
  const result = { x: Number(crop.x), y: Number(crop.y), width: Number(crop.width), height: Number(crop.height) };
  if (Object.values(result).some(number => !Number.isFinite(number)) || result.x < 0 || result.y < 0 || result.width < 0.05 || result.height < 0.05 || result.x + result.width > 1.001 || result.y + result.height > 1.001) throw new Error('Некорректная область ручного кадрирования.');
  return result;
}

function validTextOverlays(value: unknown, duration: number): TextOverlay[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Можно добавить до восьми текстовых блоков.');
  return value.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const overlay = { id: String(item.id || `text-${index}`), text: String(item.text ?? '').trim(), x: Number(item.x), y: Number(item.y), fontFamily: String(item.fontFamily) as TextOverlay['fontFamily'], fontSize: Number(item.fontSize), color: String(item.color), backgroundColor: String(item.backgroundColor), backgroundOpacity: Number(item.backgroundOpacity), bold: item.bold !== false, start: Number(item.start), end: Number(item.end) };
    if (!overlay.text || overlay.text.length > 300 || !overlayFonts.has(overlay.fontFamily) || !hexColor.test(overlay.color) || !hexColor.test(overlay.backgroundColor) || !Number.isFinite(overlay.x) || !Number.isFinite(overlay.y) || overlay.x < 0.03 || overlay.x > 0.97 || overlay.y < 0.03 || overlay.y > 0.97 || !Number.isFinite(overlay.fontSize) || overlay.fontSize < 20 || overlay.fontSize > 120 || !Number.isFinite(overlay.backgroundOpacity) || overlay.backgroundOpacity < 0 || overlay.backgroundOpacity > 1 || !Number.isFinite(overlay.start) || !Number.isFinite(overlay.end) || overlay.start < 0 || overlay.end <= overlay.start || overlay.end > duration + 0.01) throw new Error(`Проверьте настройки текстового блока ${index + 1}.`);
    return overlay;
  });
}

async function loadSegments(projectDirectory: string): Promise<Segment[]> {
  const v2 = path.join(projectDirectory, 'transcript-v2.json');
  if (await access(v2).then(() => true).catch(() => false)) return transcriptV2Segments(parseTranscriptArtifactV2(JSON.parse(await readFile(v2, 'utf8'))));
  const fallback = JSON.parse(await readFile(path.join(projectDirectory, 'transcript.json'), 'utf8')) as { segments?: Segment[] };
  if (!Array.isArray(fallback.segments)) throw new Error('Сохранённая расшифровка повреждена.');
  return fallback.segments;
}

function clipText(segments: Segment[], start: number, end: number) {
  return segments.filter(segment => segment.end > start && segment.start < end).map(segment => segment.text.trim()).filter(Boolean).join(' ').replace(/\s+/gu, ' ').trim();
}

function transcriptLines(segments: Segment[], start: number, end: number) {
  return segments.filter(segment => segment.end > start && segment.start < end).map(segment => ({ id: segment.id, start: Math.max(0, segment.start - start), end: Math.min(end - start, segment.end - start), text: segment.text.trim() })).filter(segment => segment.text && segment.end > segment.start);
}

function editedSegments(text: string, start: number, end: number, original: Segment[]): Segment[] {
  const words = text.match(/\S+/gu) ?? [];
  if (!words.length) return [];
  const originalWords = original.flatMap(segment => segment.words ?? []).filter(word => word.end > start && word.start < end);
  let timedWords: TimedToken[];
  if (originalWords.length === words.length) timedWords = originalWords.map((word, index) => ({ ...word, text: words[index] }));
  else {
    const duration = (end - start) / words.length;
    timedWords = words.map((word, index) => ({ text: word, start: start + duration * index, end: start + duration * (index + 1) }));
  }
  return [{ id: 0, start, end, text: words.join(' '), words: timedWords }];
}

function relativeSegments(segments: Segment[], offset: number): Segment[] {
  const shift = (token: TimedToken) => ({ ...token, start: token.start - offset, end: token.end - offset });
  return segments.map(segment => ({
    ...segment,
    start: segment.start - offset,
    end: segment.end - offset,
    ...(segment.tokens ? { tokens: segment.tokens.map(shift) } : {}),
    ...(segment.words ? { words: segment.words.map(shift) } : {}),
  }));
}

function settings(row: Record<string, unknown>) {
  return {
    subtitles: Boolean(row.subtitles),
    subtitleText: row.subtitle_text ? String(row.subtitle_text) : null,
    captionStyle: String(row.caption_style ?? row.project_caption_style ?? 'modern') as CaptionStyle,
    subtitleColor: String(row.subtitle_color ?? row.project_subtitle_color ?? '#ffd400'),
    wordHighlight: Boolean(row.word_highlight ?? row.project_word_highlight ?? 1),
    highlightKeywords: Boolean(row.highlight_keywords ?? row.project_highlight_keywords),
    addEmojis: Boolean(row.add_emojis ?? row.project_add_emojis),
    autoCensor: Boolean(row.auto_censor ?? row.project_auto_censor),
    autoReframe: Boolean(row.auto_reframe),
    reframeOffset: Number(row.reframe_offset ?? 0),
    manualCrop: storedJson<ManualCrop | null>(row.manual_crop, null),
    textOverlays: storedJson<TextOverlay[]>(row.text_overlays, []),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const row = /^[0-9a-f-]{36}$/u.test(id) ? getOwnedClipForEdit(id, user.id) : undefined;
  if (!row) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  if (row.project_kind === 'montage') return Response.json({ error: 'Редактор монтажных клипов пока недоступен: изменение уничтожило бы склейки.' }, { status: 409 });
  const projectDirectory = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects', String(row.project_id));
  const segments = await loadSegments(projectDirectory);
  const current = settings(row);
  const start = Number(row.start); const end = Number(row.end);
  return Response.json({ settings: { ...current, subtitleText: current.subtitleText ?? clipText(segments, start, end), transcript: transcriptLines(segments, start, end), cutSegments: storedJson<number[]>(row.cut_segments, []), start, duration: end - start, aspectRatio: String(row.aspect_ratio ?? '9:16'), cropAspectRatio: Boolean(row.adhd_mode) ? '16:9' : String(row.aspect_ratio ?? '9:16'), adhdMode: Boolean(row.adhd_mode) } }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  const { id } = await context.params;
  const row = /^[0-9a-f-]{36}$/u.test(id) ? getOwnedClipForEdit(id, user.id) : undefined;
  if (!row) return Response.json({ error: 'Клип не найден.' }, { status: 404 });
  if (row.project_kind === 'montage') return Response.json({ error: 'Редактор монтажных клипов пока недоступен: изменение уничтожило бы склейки.' }, { status: 409 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const input = body as Record<string, unknown>;
  const subtitles = input.subtitles !== false;
  const subtitleText = typeof input.subtitleText === 'string' ? input.subtitleText.replace(/\s+/gu, ' ').trim() : '';
  if (subtitles && (!subtitleText || subtitleText.length > 4000)) return Response.json({ error: 'Текст субтитров должен содержать от 1 до 4000 символов.' }, { status: 400 });
  const captionStyle = CAPTION_STYLES.includes(input.captionStyle as CaptionStyle) ? input.captionStyle as CaptionStyle : 'modern';
  const subtitleColor = typeof input.subtitleColor === 'string' && allowedColors.has(input.subtitleColor) ? input.subtitleColor : '#ffd400';
  const aspectRatio = ASPECT_RATIOS.includes(row.aspect_ratio as AspectRatio) ? row.aspect_ratio as AspectRatio : '9:16';
  const requestedOffset = typeof input.reframeOffset === 'number' && Number.isFinite(input.reframeOffset) ? input.reframeOffset : 0;
  const reframeOffset = Math.min(0.35, Math.max(-0.35, requestedOffset));
  const projectDirectory = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects', String(row.project_id));
  const segments = await loadSegments(projectDirectory);
  const start = Number(row.start); const end = Number(row.end);
  const lines = transcriptLines(segments, start, end);
  const cutSegments = input.cutSegments;
  if (!Array.isArray(cutSegments) || cutSegments.length > lines.length || !cutSegments.every(id => Number.isInteger(id) && lines.some(line => line.id === id)) || new Set(cutSegments).size !== cutSegments.length)
    return Response.json({ error: 'Некорректный список удаляемых фраз.' }, { status: 400 });
  const cuts = lines.filter(line => cutSegments.includes(line.id)).map(line => ({ start: line.start, end: line.end })).sort((a, b) => a.start - b.start);
  const removedSeconds = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  if (removedSeconds > end - start - 5) return Response.json({ error: 'В клипе должно остаться хотя бы 5 секунд.' }, { status: 400 });
  let manualCrop: ManualCrop | null; let textOverlays: TextOverlay[];
  try { manualCrop = validCrop(input.manualCrop); textOverlays = validTextOverlays(input.textOverlays ?? [], end - start); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Некорректные настройки редактора.' }, { status: 400 }); }
  const renderSegments = subtitles ? editedSegments(subtitleText, start, end, segments) : segments;
  const trackPath = path.join(projectDirectory, 'subject-track.json');
  const track = await access(trackPath).then(async () => (JSON.parse(await readFile(trackPath, 'utf8')) as { points?: SubjectPoint[] }).points ?? []).catch(() => []);
  const oldVideo = String(row.video_path); const oldPreview = String(row.preview_path);
  const intermediateFiles: string[] = [];
  try {
    const processingMode = row.processing_mode === 'fast' ? 'fast' : 'eco';
    let videoPath: string;
    if (Boolean(row.adhd_mode)) {
      const gameplayPath = row.adhd_gameplay ? await resolveGameplayVideo(String(row.adhd_gameplay)) : null;
      if (!gameplayPath) throw new Error('Видео для СДВГ-компоновки больше недоступно. Выберите его заново в новом проекте.');
      const outputDirectory = path.dirname(oldVideo);
      const base = await renderClip({ sourcePath: path.join(projectDirectory, 'source.mp4'), outputDirectory, start, end, segments, subtitles: false, autoCensor: input.autoCensor === true, processingMode, subjectTrack: track, autoReframe: Boolean(row.auto_reframe), aspectRatio: '16:9', fitBackground: row.fit_background === 'blur' ? 'blur' : 'black', cover: true, watermark: false, manualCrop, reframeOffset, minDuration: 1, maxDuration: 600 });
      intermediateFiles.push(base, base.replace(/\.mp4$/u, '.jpg'));
      const position = ['left', 'right'].includes(String(row.adhd_main_position)) ? String(row.adhd_main_position) as 'left' | 'right' : 'center';
      const composite = await applyAdhdGameplay(base, gameplayPath, outputDirectory, start, processingMode, position);
      intermediateFiles.push(composite);
      videoPath = await renderClip({ sourcePath: composite, outputDirectory, start: 0, end: end - start, segments: relativeSegments(renderSegments, start), subtitles, subtitleColor, captionStyle, wordHighlight: input.wordHighlight !== false, highlightKeywords: input.highlightKeywords === true, addEmojis: input.addEmojis === true, autoCensor: false, processingMode, autoReframe: false, aspectRatio, fitBackground: 'black', textOverlays, minDuration: 1, maxDuration: 600 });
    } else {
      videoPath = await renderClip({ sourcePath: path.join(projectDirectory, 'source.mp4'), outputDirectory: path.dirname(oldVideo), start, end, segments: renderSegments, subtitles, subtitleColor, captionStyle, wordHighlight: input.wordHighlight !== false, highlightKeywords: input.highlightKeywords === true, addEmojis: input.addEmojis === true, autoCensor: input.autoCensor === true, processingMode, subjectTrack: track, autoReframe: Boolean(row.auto_reframe), aspectRatio, fitBackground: row.fit_background === 'blur' ? 'blur' : 'black', manualCrop, textOverlays, reframeOffset, minDuration: 1, maxDuration: 600 });
    }
    if (cuts.length) {
      const rendered = videoPath;
      intermediateFiles.push(rendered, rendered.replace(/\.mp4$/u, '.jpg'));
      videoPath = await cutRenderedClip(rendered, end - start, cuts, processingMode);
    }
    const previewPath = videoPath.replace(/\.mp4$/u, '.jpg');
    updateOwnedClipRender(id, user.id, { videoPath, previewPath, sizeBytes: (await stat(videoPath)).size, subtitles, subtitleText, captionStyle, subtitleColor, wordHighlight: input.wordHighlight !== false, highlightKeywords: input.highlightKeywords === true, addEmojis: input.addEmojis === true, autoCensor: input.autoCensor === true, reframeOffset, manualCrop, textOverlays, cutSegments });
    await Promise.all([...intermediateFiles, oldVideo, oldPreview].filter(file => file !== videoPath && file !== previewPath).map(file => rm(file, { force: true })));
    return Response.json({ ok: true });
  } catch (error) {
    await Promise.all(intermediateFiles.map(file => rm(file, { force: true })));
    return Response.json({ error: error instanceof Error ? error.message : 'Не удалось перерендерить клип.' }, { status: 500 });
  }
}
