import { randomUUID } from 'node:crypto';
import { createProject, listProjects } from '@/server/projects';
import { startNextQueuedProject } from '@/server/start-worker';
import { getYouTubeVideoId } from '@/lib/youtube';
import { currentUser } from '@/server/auth';
import { maybeCleanupExpiredCache } from '@/server/storage-cleanup';
import { ADHD_MAIN_POSITIONS, ASPECT_RATIOS, CAPTION_STYLES, CLIP_LENGTHS, FIT_BACKGROUNDS, type AdhdMainPosition, type AspectRatio, type CaptionStyle, type ClipLength, type FitBackground } from '@/lib/project-types';
import { resolveGameplayVideo } from '@/server/gameplay';

export const runtime = 'nodejs';
const allowedColors = new Set(['#ffd400', '#28c76f', '#43a5ff', '#ffffff']);

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  await maybeCleanupExpiredCache(user.id, user.cacheRetentionDays);
  startNextQueuedProject();
  const requestedKind = new URL(request.url).searchParams.get('kind');
  const kind = requestedKind === 'clips' || requestedKind === 'montage' ? requestedKind : undefined;
  return Response.json({ projects: listProjects(user.id, 20, kind) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Некорректный JSON.' }, { status: 400 }); }
  const input = body as { kind?: unknown; url?: unknown; subtitles?: unknown; subtitleColor?: unknown; count?: unknown; processingMode?: unknown; autoReframe?: unknown; aspectRatio?: unknown; clipLength?: unknown; captionStyle?: unknown; wordHighlight?: unknown; highlightKeywords?: unknown; addEmojis?: unknown; autoCensor?: unknown; clipPrompt?: unknown; fitBackground?: unknown; addBroll?: unknown; adhdMode?: unknown; adhdGameplay?: unknown; adhdMainPosition?: unknown };
  if (input.kind !== undefined && input.kind !== 'clips' && input.kind !== 'montage') return Response.json({ error: 'Некорректный режим проекта.' }, { status: 400 });
  if (typeof input.url !== 'string') return Response.json({ error: 'Укажите ссылку YouTube.' }, { status: 400 });
  const videoId = getYouTubeVideoId(input.url.trim());
  if (!videoId) return Response.json({ error: 'Нужна HTTPS-ссылка на конкретное видео YouTube.' }, { status: 400 });
  if (typeof input.subtitles !== 'boolean') return Response.json({ error: 'Некорректная настройка субтитров.' }, { status: 400 });
  if (input.autoReframe !== undefined && typeof input.autoReframe !== 'boolean') return Response.json({ error: 'Некорректная настройка кадрирования.' }, { status: 400 });
  if (input.addBroll !== undefined && typeof input.addBroll !== 'boolean') return Response.json({ error: 'Некорректная настройка AI B-roll.' }, { status: 400 });
  if (input.addBroll === true && (!process.env.KIMI_API_KEY || !process.env.PEXELS_API_KEY)) return Response.json({ error: 'AI B-roll пока недоступен: настройте KIMI_API_KEY и PEXELS_API_KEY.' }, { status: 503 });
  if (input.adhdMode !== undefined && typeof input.adhdMode !== 'boolean') return Response.json({ error: 'Некорректная настройка СДВГ-клипа.' }, { status: 400 });
  if (input.adhdGameplay !== undefined && typeof input.adhdGameplay !== 'string') return Response.json({ error: 'Некорректное фоновое видео.' }, { status: 400 });
  for (const key of ['wordHighlight', 'highlightKeywords', 'addEmojis', 'autoCensor'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') return Response.json({ error: 'Некорректная настройка субтитров.' }, { status: 400 });
  if (input.clipPrompt !== undefined && typeof input.clipPrompt !== 'string') return Response.json({ error: 'Некорректное описание момента.' }, { status: 400 });
  const clipPrompt = typeof input.clipPrompt === 'string' ? input.clipPrompt.replace(/\s+/gu, ' ').trim() : '';
  if (clipPrompt.length > 300) return Response.json({ error: 'Описание момента должно быть короче 300 символов.' }, { status: 400 });
  const subtitleColor = typeof input.subtitleColor === 'string' && allowedColors.has(input.subtitleColor) ? input.subtitleColor : '#ffd400';
  const count = Number(input.count ?? 2);
  if (!Number.isInteger(count) || count < 1 || count > 5) return Response.json({ error: 'Количество клипов должно быть от 1 до 5.' }, { status: 400 });
  if (input.kind === 'montage' && (count > 3 || input.adhdMode === true || input.addBroll === true)) return Response.json({ error: 'В первом прототипе монтажа доступны до трёх клипов без СДВГ-фона и B-roll.' }, { status: 400 });
  const adhdMode = input.adhdMode === true;
  const adhdGameplay = adhdMode && typeof input.adhdGameplay === 'string' && await resolveGameplayVideo(input.adhdGameplay) ? input.adhdGameplay : null;
  const adhdMainPosition = ADHD_MAIN_POSITIONS.includes(input.adhdMainPosition as AdhdMainPosition) ? input.adhdMainPosition as AdhdMainPosition : 'center';
  if (adhdMode && !adhdGameplay) return Response.json({ error: 'Выберите доступное видео для СДВГ-клипа.' }, { status: 400 });
  const aspectRatio = adhdMode || input.kind === 'montage' ? '9:16' : ASPECT_RATIOS.includes(input.aspectRatio as AspectRatio) ? input.aspectRatio as AspectRatio : '9:16';
  const clipLength = CLIP_LENGTHS.includes(input.clipLength as ClipLength) ? input.clipLength as ClipLength : 'medium';
  const captionStyle = CAPTION_STYLES.includes(input.captionStyle as CaptionStyle) ? input.captionStyle as CaptionStyle : 'modern';
  const fitBackground = FIT_BACKGROUNDS.includes(input.fitBackground as FitBackground) ? input.fitBackground as FitBackground : 'black';
  const processingMode = 'fast';
  const id = randomUUID();
  const project = createProject({ id, ownerId: user.id, videoId, sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, kind: input.kind === 'montage' ? 'montage' : 'clips', subtitles: input.subtitles, subtitleColor, requestedClips: count, processingMode, autoReframe: input.autoReframe === true, aspectRatio, clipLength, captionStyle, wordHighlight: input.wordHighlight !== false, highlightKeywords: input.highlightKeywords === true, addEmojis: input.addEmojis === true, autoCensor: input.autoCensor === true, clipPrompt: clipPrompt || null, fitBackground, addBroll: input.addBroll === true, adhdMode, adhdGameplay, adhdMainPosition });
  startNextQueuedProject();
  return Response.json({ project }, { status: 201 });
}
