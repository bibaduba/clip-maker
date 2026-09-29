import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addClip, getProject, getSelectionPreferencesForProject, updateProject } from '../../src/server/projects';
import { normalizeTranscript, requireDisk, run, writeJson, type Segment } from './core';
import { expandStoryCandidates, SELECTION_VERSION, selectBestClipsByTimeChunks, type ClipCandidate } from './selection';
import { renderClip } from './render';
import { detectSubjectTrack } from './subject-tracking';
import { parseTranscriptArtifactV2, transcriptV2Segments } from './transcript-v2';
import { clipLengthRanges } from '../../src/lib/project-types';
import { planBroll } from './broll-planner';
import { downloadStockMedia, searchPexelsImages, searchPexelsVideos, type StockImage, type StockVideo } from './broll-stock';
import { applyBroll, type BrollAsset } from './broll-render';
import { applyAdhdGameplay } from './adhd-render';
import { resolveGameplayVideo } from '../../src/server/gameplay';
import { discoverVisualCandidates, reviewCandidateFrames } from './visual-review';
import type { MontagePlan } from './montage-plan';
import { buildSmartMontagePlan } from './montage-ai';
import { renderMontage } from './render-montage';

const projectId = process.argv[2];
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const processOptions = { signal: controller.signal };
function positiveNumber(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
const maxSourceSeconds = positiveNumber(process.env.MEDIA_MAX_SOURCE_SECONDS, 7200);
// Use a new variable so a long-running dev server cannot keep the retired
// 600-second MEDIA_MAX_ANALYZED_SECONDS value in a spawned worker.
const totalAnalysisSeconds = positiveNumber(process.env.MEDIA_TOTAL_ANALYSIS_SECONDS, maxSourceSeconds);
const maxDownloadSize = process.env.MEDIA_MAX_DOWNLOAD_SIZE ?? '1G';
const analysisChunkSeconds = positiveNumber(process.env.MEDIA_ANALYSIS_CHUNK_SECONDS, 600);
const maxGeneratedClips = 30;
const outputDimensions = { '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [864, 1080], '16:9': [1280, 720] } as const;

function ytDlpAuthenticationArgs() {
  const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
  if (cookiesFile) return ['--cookies', path.resolve(cookiesFile)];
  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (browser && browser.length <= 500 && !/[\r\n]/u.test(browser)) return ['--cookies-from-browser', browser];
  return [];
}

function readableProcessingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to decrypt with DPAPI/iu.test(message))
    return 'Windows не дал yt-dlp расшифровать cookies браузера (DPAPI). Экспортируйте cookies YouTube в файл Netscape cookies.txt, укажите его путь в YTDLP_COOKIES_FILE в .env.local, перезапустите сервер и повторите генерацию. Файл cookies имеет приоритет над YTDLP_COOKIES_FROM_BROWSER.';
  if (/sign in to confirm your age/iu.test(message))
    return 'YouTube требует подтверждение возраста. Укажите YTDLP_COOKIES_FILE с экспортированными cookies авторизованного аккаунта YouTube или YTDLP_COOKIES_FROM_BROWSER в .env.local и повторите генерацию.';
  if (/sign in to confirm you.re not a bot|use --cookies-from-browser/iu.test(message))
    return 'YouTube требует авторизацию. Настройте YTDLP_COOKIES_FILE или YTDLP_COOKIES_FROM_BROWSER в .env.local и повторите генерацию.';
  return message;
}

function downloadTimeoutMs(durationSeconds: number) {
  const configuredMinutes = Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MINUTES);
  if (Number.isFinite(configuredMinutes) && configuredMinutes > 0) return configuredMinutes * 60_000;
  // Section downloads may be processed close to real time by ffmpeg. Give them
  // twice the media duration, while retaining a sensible minimum for networks
  // that start slowly. A stuck download can still be cancelled from the UI.
  return Math.max(20 * 60_000, durationSeconds * 2_000);
}

function relativeSegments(segments: Segment[], start: number, end: number): Segment[] {
  return segments.filter(segment => segment.end > start && segment.start < end).map(segment => ({
    ...segment,
    start: Math.max(0, segment.start - start),
    end: Math.min(end - start, segment.end - start),
    words: segment.words?.filter(word => word.end > start && word.start < end).map(word => ({ ...word, start: Math.max(0, word.start - start), end: Math.min(end - start, word.end - start) })),
    tokens: segment.tokens?.filter(token => token.end > start && token.start < end).map(token => ({ ...token, start: Math.max(0, token.start - start), end: Math.min(end - start, token.end - start) })),
  }));
}

async function prepareBroll(segments: Segment[], candidate: ClipCandidate, clipDirectory: string, aspectRatio: keyof typeof outputDimensions) {
  const manifestPath = path.join(clipDirectory, 'broll-manifest.json');
  try {
    const plan = await planBroll(segments, candidate.start, candidate.end, controller.signal);
    const assets: BrollAsset[] = [];
    const sources: Array<{ suggestion: (typeof plan.suggestions)[number]; stock: StockVideo | StockImage; localPath: string }> = [];
    const failures: string[] = [];
    for (const suggestion of plan.suggestions) {
      try {
        const duration = suggestion.end - suggestion.start;
        // Generation is a later provider option; licensed stock is the safe fallback today.
        const stocks = suggestion.mediaType === 'image'
          ? await searchPexelsImages(suggestion.query, aspectRatio, controller.signal)
          : await searchPexelsVideos(suggestion.query, aspectRatio, duration, controller.signal);
        if (!stocks.length) { failures.push(`Нет результатов: ${suggestion.query}`); continue; }
        let selected: { stock: StockVideo | StockImage; localPath: string } | null = null;
        for (const stock of stocks) {
          const localPath = path.join(clipDirectory, 'broll', `pexels-${stock.providerId}.${suggestion.mediaType === 'image' ? 'jpg' : 'mp4'}`);
          try { await downloadStockMedia(stock, localPath, controller.signal); selected = { stock, localPath }; break; }
          catch (error) { if (controller.signal.aborted) throw error; failures.push(error instanceof Error ? error.message : String(error)); }
        }
        if (!selected) continue;
        assets.push({ path: selected.localPath, start: suggestion.start - candidate.start, end: suggestion.end - candidate.start, kind: suggestion.mediaType, layout: suggestion.layout, motion: suggestion.motion });
        sources.push({ suggestion, stock: selected.stock, localPath: selected.localPath });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    await writeJson(manifestPath, { version: 1, createdAt: new Date().toISOString(), plan, sources, failures });
    const brollError = assets.length ? null : plan.suggestions.length ? failures.join(' ').slice(0, 500) || 'Pexels не нашёл подходящие видео для предложенных вставок.' : 'Kimi не нашёл уместных мест для B-roll в этом клипе.';
    return { assets, sources: sources.map(({ stock }) => ({ provider: stock.provider, pageUrl: stock.pageUrl, creator: stock.creator, creatorUrl: stock.creatorUrl, license: stock.license })), brollError };
  } catch (error) {
    await writeJson(manifestPath, { version: 1, createdAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), sources: [] });
    return { assets: [] as BrollAsset[], sources: [] as Array<{ provider: 'pexels'; pageUrl: string; creator: string; creatorUrl: string; license: 'Pexels License' }>, brollError: error instanceof Error ? error.message : String(error) };
  }
}

async function cleanupPartialFiles(directory: string) {
  if (!await access(directory).then(() => true).catch(() => false)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await cleanupPartialFiles(target);
    else if (/\.partial\.(?:mp4|jpg)$/iu.test(entry.name)) await rm(target, { force: true });
  }
}

function scaledClipTarget(minimum: number, duration: number) {
  // Two strong clips per ten minutes is a useful default density. The user's
  // chosen count remains a minimum, while the hard cap protects disk and render time.
  return Math.min(maxGeneratedClips, Math.max(minimum, Math.ceil(duration / analysisChunkSeconds) * 2));
}

async function main() {
  if (!/^[0-9a-f-]{36}$/.test(projectId ?? '')) throw new Error('Некорректный ID проекта.');
  const project = getProject(projectId);
  if (!project) throw new Error('Проект не найден.');
  const heartbeat = setInterval(() => updateProject(project.id, { workerHeartbeatAt: new Date().toISOString() }), 10_000);
  heartbeat.unref();
  const directory = path.resolve('storage/projects', project.id);
  const model = path.resolve(process.env.WHISPER_MODEL ?? 'storage/models/ggml-small.bin');
  await mkdir(directory, { recursive: true });
  await cleanupPartialFiles(directory);
  await requireDisk(path.resolve('storage'));
  const canonicalUrl = `https://www.youtube.com/watch?v=${project.videoId}`;
  const yt = ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '30', '--retries', '10', '--fragment-retries', '10', '--retry-sleep', 'fragment:exp=1:20', '--js-runtimes', 'node', ...ytDlpAuthenticationArgs()];

  try {
    updateProject(project.id, { status: 'metadata', error: null });
    const metadata = JSON.parse(await run('yt-dlp', [...yt, '--dump-single-json', '--skip-download', '--', canonicalUrl], { ...processOptions, timeoutMs: 120_000 }));
    if (metadata.id !== project.videoId || metadata.is_live || metadata.live_status === 'is_upcoming') throw new Error('Нужна доступная завершённая запись YouTube.');
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > maxSourceSeconds) throw new Error(`Поддерживаются завершённые видео длительностью до ${Math.round(maxSourceSeconds / 60)} минут.`);
    const analyzedDuration = Math.min(Number(metadata.duration), totalAnalysisSeconds);
    updateProject(project.id, { title: String(metadata.title || 'YouTube video'), sourceDuration: Number(metadata.duration), analyzedDuration, status: 'downloading' });
    await writeJson(path.join(directory, 'source.json'), { id: project.videoId, title: metadata.title, duration: metadata.duration, analyzedDuration, url: canonicalUrl });

    let videoPath = path.join(directory, 'source.mp4');
    let hasVideo = await access(videoPath).then(() => true).catch(() => false);
    if (hasVideo) {
      const cachedDuration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath], processOptions).catch(() => '0'));
      if (!Number.isFinite(cachedDuration) || cachedDuration < analyzedDuration - 2) {
        await Promise.all(['source.mp4', 'audio.wav', 'transcript.json', 'transcript-v2.json', 'transcript.txt', 'selection.json', 'approved-selection.json'].map(file => rm(path.join(directory, file), { force: true })));
        await rm(path.join(directory, 'selection-blocks'), { recursive: true, force: true });
        hasVideo = false;
      }
    }
    if (!hasVideo) {
      const sectionArgs = analyzedDuration < Number(metadata.duration) - 1
        ? ['--download-sections', `*0-${analyzedDuration}`]
        : [];
      const download = await run('yt-dlp', [...yt, '-f', 'bv*[height<=720]+ba/b[height<=720]', ...sectionArgs, '--max-filesize', maxDownloadSize, '--merge-output-format', 'mp4', '-o', path.join(directory, 'source.%(ext)s'), '--print', 'after_move:filepath', '--', canonicalUrl], { ...processOptions, timeoutMs: downloadTimeoutMs(analyzedDuration) });
      videoPath = download.trim().split('\n').at(-1) ?? '';
      if (path.dirname(path.resolve(videoPath)) !== directory) throw new Error('Загрузчик вернул неожиданный путь.');
    }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', videoPath], processOptions));
    if (!probe.streams?.some((s: { codec_type: string }) => s.codec_type === 'video') || !probe.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio')) throw new Error('В исходнике нужны видео и звук.');

    updateProject(project.id, { status: 'transcribing' });
    const audioPath = path.join(directory, 'audio.wav');
    if (!await access(audioPath).then(() => true).catch(() => false)) await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', videoPath, '-t', String(analyzedDuration), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', audioPath], { ...processOptions, timeoutMs: 300_000 });
    const actualDuration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath], processOptions));
    if (!Number.isFinite(actualDuration) || actualDuration < 20 || actualDuration > analyzedDuration + 1) throw new Error('Некорректная длительность аудио.');
    const transcriptPath = path.join(directory, 'transcript.json');
    const transcriptV2Path = path.join(directory, 'transcript-v2.json');
    let segments;
    if (await access(transcriptV2Path).then(() => true).catch(() => false)) {
      segments = transcriptV2Segments(parseTranscriptArtifactV2(JSON.parse(await readFile(transcriptV2Path, 'utf8'))));
    } else {
      const defaultPython = path.resolve(process.platform === 'win32' ? '.venv-asr/Scripts/python.exe' : '.venv-asr/bin/python');
      const whisperxPython = path.resolve(process.env.WHISPERX_PYTHON ?? defaultPython);
      const whisperxScript = path.resolve('scripts/asr/transcribe.py');
      const hasWhisperx = await Promise.all([whisperxPython, whisperxScript].map(file => access(file).then(() => true).catch(() => false))).then(results => results.every(Boolean));
      if (hasWhisperx) {
        await run(whisperxPython, [whisperxScript, audioPath, transcriptV2Path, '--device', process.env.WHISPERX_DEVICE ?? 'auto', '--compute-type', 'float16', '--model', process.env.WHISPERX_MODEL ?? 'large-v3-turbo', '--language', 'ru', '--batch-size', project.processingMode === 'fast' ? '12' : '8', '--model-cache', path.resolve('.cache-asr')], { ...processOptions, timeoutMs: 1_800_000 });
        segments = transcriptV2Segments(parseTranscriptArtifactV2(JSON.parse(await readFile(transcriptV2Path, 'utf8'))));
      } else if (await access(transcriptPath).then(() => true).catch(() => false)) {
        segments = JSON.parse(await readFile(transcriptPath, 'utf8')).segments;
      } else {
        await stat(model).catch(() => { throw new Error('Модель Whisper не установлена.'); });
        const whisperPrefix = path.join(directory, 'whisper');
        await run(process.env.WHISPER_CLI ?? 'whisper-cli', ['-m', model, '-f', audioPath, '-l', 'ru', '-ojf', '-of', whisperPrefix, '-t', project.processingMode === 'fast' ? '6' : '2'], { ...processOptions, timeoutMs: 1_800_000 });
        const raw = JSON.parse(await readFile(`${whisperPrefix}.json`, 'utf8'));
        segments = normalizeTranscript(raw, actualDuration);
      }
      const usingWhisperx = await access(transcriptV2Path).then(() => true).catch(() => false);
      await writeJson(transcriptPath, {
        schemaVersion: 2,
        language: 'ru',
        sourceOffset: 0,
        duration: actualDuration,
        segments,
        model: usingWhisperx ? process.env.WHISPERX_MODEL ?? 'large-v3-turbo' : 'whisper.cpp',
        ...(usingWhisperx ? {} : { modelSha256: createHash('sha256').update(await readFile(model)).digest('hex') }),
      });
      await writeFile(path.join(directory, 'transcript.txt'), segments.map((s: { start: number; end: number; text: string }) => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.text}`).join('\n\n') + '\n');
    }

    const requestedClips = scaledClipTarget(project.requestedClips, actualDuration);
    const selectionPreferences = getSelectionPreferencesForProject(project.id);
    const preferenceFingerprint = createHash('sha256').update(JSON.stringify(selectionPreferences)).digest('hex');
    updateProject(project.id, { status: 'selecting', analyzedDuration: actualDuration, requestedClips });
    const selectionPath = path.join(directory, 'selection.json');
    const clipRange = clipLengthRanges[project.clipLength];
    const poolCount = Math.min(40, requestedClips + Math.max(4, Math.ceil(requestedClips / 2)));
    let cachedSelection: { selectionVersion?: number; requestedClips?: number; poolCount?: number; analyzedDuration?: number; preferenceFingerprint?: string; candidates?: ClipCandidate[] } | null = null;
    if (await access(selectionPath).then(() => true).catch(() => false)) {
      try { cachedSelection = JSON.parse(await readFile(selectionPath, 'utf8')); } catch { cachedSelection = null; }
    }
    const cacheValid = cachedSelection?.selectionVersion === SELECTION_VERSION && cachedSelection.requestedClips === requestedClips && cachedSelection.poolCount === poolCount && cachedSelection.preferenceFingerprint === preferenceFingerprint && Math.abs((cachedSelection.analyzedDuration ?? 0) - actualDuration) < 1 && Array.isArray(cachedSelection.candidates);
    const rawCandidates = cacheValid
      ? cachedSelection!.candidates!
      : expandStoryCandidates(await selectBestClipsByTimeChunks(segments, path.join(directory, 'selection-blocks'), poolCount, analysisChunkSeconds, controller.signal, project.processingMode, clipRange.min, clipRange.max, project.clipPrompt ?? '', selectionPreferences), segments, clipRange.min, clipRange.max);
    const candidatePool = cacheValid
      ? rawCandidates
      : [
          ...await reviewCandidateFrames(videoPath, directory, rawCandidates, controller.signal),
          ...await discoverVisualCandidates(videoPath, directory, actualDuration, segments, rawCandidates, clipRange.min, clipRange.max, controller.signal),
        ].sort((a, b) => b.score - a.score).slice(0, poolCount);
    if (!candidatePool.length) throw new Error('Не найдено достаточно законченных фрагментов без рекламы.');
    await writeJson(selectionPath, { selectionVersion: SELECTION_VERSION, requestedClips, poolCount, analyzedDuration: actualDuration, chunkSeconds: analysisChunkSeconds, preferenceFingerprint, candidates: candidatePool });
    if (project.kind === 'montage') {
      const planPath = path.join(directory, 'montage-plan.json');
      const approvedMontagePath = path.join(directory, 'approved-montage.json');
      const plans: MontagePlan[] = [];
      for (const candidate of candidatePool) {
        if (plans.length >= requestedClips) break;
        const plan = await buildSmartMontagePlan(videoPath, directory, candidate, segments, controller.signal);
        if (plan) plans.push(plan);
      }
      if (!plans.length) throw new Error('Не удалось составить монтажный план с несколькими фрагментами. Попробуйте другое видео.');
      await writeJson(planPath, { selectionVersion: SELECTION_VERSION, preferenceFingerprint, plans });
      let approvedMontage: { selectionVersion?: number; preferenceFingerprint?: string; plans?: MontagePlan[] } | null = null;
      if (await access(approvedMontagePath).then(() => true).catch(() => false)) {
        try { approvedMontage = JSON.parse(await readFile(approvedMontagePath, 'utf8')); } catch { approvedMontage = null; }
      }
      if (!approvedMontage || approvedMontage.selectionVersion !== SELECTION_VERSION || approvedMontage.preferenceFingerprint !== preferenceFingerprint || !Array.isArray(approvedMontage.plans) || !approvedMontage.plans.length) {
        updateProject(project.id, { status: 'review', workerPid: null, workerHeartbeatAt: null });
        return;
      }
      updateProject(project.id, { status: 'rendering' });
      const montageTrack = project.autoReframe ? await detectSubjectTrack(videoPath, directory, actualDuration, project.processingMode, controller.signal) : [];
      for (const plan of approvedMontage.plans) {
        if (project.clips.some(clip => Math.abs(clip.start - plan.pieces[0].start) < 0.05)) continue;
        await requireDisk(path.resolve('storage'));
        const clipId = randomUUID();
        const clipDirectory = path.join(directory, 'clips', clipId);
        const file = await renderMontage(videoPath, clipDirectory, plan, segments, project, montageTrack, controller.signal);
        addClip({ id: clipId, projectId: project.id, title: plan.title, reason: plan.reason, queryMatch: null, viralPotential: plan.sourceCandidate.score, hookScore: null, completenessScore: null, valueScore: null, start: plan.pieces[0].start, end: plan.pieces.at(-1)!.end, renderedDuration: plan.totalDuration, subtitles: project.subtitles, sizeBytes: (await stat(file)).size, videoPath: file, previewPath: file.replace(/\.mp4$/u, '.jpg'), createdAt: new Date().toISOString(), brollSources: [], brollError: null, seriesKey: null, seriesPart: null, seriesTotal: null, favorite: false, notInteresting: false, montagePlan: plan });
      }
      updateProject(project.id, { status: 'completed', workerPid: null, workerHeartbeatAt: null });
      return;
    }
    const approvedPath = path.join(directory, 'approved-selection.json');
    let approved: { preferenceFingerprint?: string; selectionVersion?: number; candidates?: ClipCandidate[] } | null = null;
    if (await access(approvedPath).then(() => true).catch(() => false)) {
      try { approved = JSON.parse(await readFile(approvedPath, 'utf8')); } catch { approved = null; }
    }
    if (!approved || approved.selectionVersion !== SELECTION_VERSION || approved.preferenceFingerprint !== preferenceFingerprint || !Array.isArray(approved.candidates) || !approved.candidates.length) {
      updateProject(project.id, { status: 'review', workerPid: null, workerHeartbeatAt: null });
      return;
    }
    const selectedCandidates = approved.candidates;

    updateProject(project.id, { status: 'rendering' });
    const subjectTrack = project.autoReframe ? await detectSubjectTrack(videoPath, directory, actualDuration, project.processingMode, controller.signal) : [];
    const adhdGameplayPath = project.adhdMode && project.adhdGameplay ? await resolveGameplayVideo(project.adhdGameplay) : null;
    if (project.adhdMode && !adhdGameplayPath) throw new Error('Выбранное видео для СДВГ-клипа больше недоступно.');
    for (const candidate of selectedCandidates) {
      if (project.clips.some(clip => Math.abs(clip.start - candidate.start) < 0.05 && Math.abs(clip.end - candidate.end) < 0.05)) continue;
      await requireDisk(path.resolve('storage'));
      const clipId = randomUUID();
      const clipDirectory = path.join(directory, 'clips', clipId);
      const broll = project.addBroll ? await prepareBroll(segments, candidate, clipDirectory, project.aspectRatio) : { assets: [], sources: [], brollError: null };
      const brollAssets = broll.assets;
      let file: string;
      if (brollAssets.length || adhdGameplayPath) {
        const base = await renderClip({ sourcePath: videoPath, outputDirectory: clipDirectory, start: candidate.start, end: candidate.end, segments, subtitles: false, autoCensor: project.autoCensor, processingMode: project.processingMode, subjectTrack, autoReframe: project.autoReframe, aspectRatio: adhdGameplayPath ? '16:9' : project.aspectRatio, fitBackground: project.fitBackground, cover: Boolean(adhdGameplayPath), watermark: false, minDuration: clipRange.min, maxDuration: clipRange.max, signal: controller.signal });
        const [width, height] = outputDimensions[project.aspectRatio];
        let composite = base;
        const intermediateFiles: string[] = [];
        if (adhdGameplayPath) {
          const previous = composite;
          composite = await applyAdhdGameplay(previous, adhdGameplayPath, clipDirectory, candidate.start, project.processingMode, project.adhdMainPosition, controller.signal);
          if (previous !== base) intermediateFiles.push(previous);
          intermediateFiles.push(composite);
        }
        if (brollAssets.length) {
          const previous = composite;
          composite = await applyBroll(composite, clipDirectory, width, height, brollAssets, project.processingMode, controller.signal);
          if (previous !== base) intermediateFiles.push(previous);
          intermediateFiles.push(composite);
        }
        const duration = candidate.end - candidate.start;
        file = await renderClip({ sourcePath: composite, outputDirectory: clipDirectory, start: 0, end: duration, segments: relativeSegments(segments, candidate.start, candidate.end), subtitles: project.subtitles, subtitleColor: project.subtitleColor, captionStyle: project.captionStyle, wordHighlight: project.wordHighlight, highlightKeywords: project.highlightKeywords, addEmojis: project.addEmojis, autoCensor: false, processingMode: project.processingMode, autoReframe: false, aspectRatio: project.aspectRatio, fitBackground: 'black', minDuration: 1, maxDuration: 600, signal: controller.signal });
        await Promise.all([...new Set([base, base.replace(/\.mp4$/u, '.jpg'), ...intermediateFiles])].filter(item => item !== file).map(item => rm(item, { force: true })));
      } else {
        file = await renderClip({ sourcePath: videoPath, outputDirectory: clipDirectory, start: candidate.start, end: candidate.end, segments, subtitles: project.subtitles, subtitleColor: project.subtitleColor, captionStyle: project.captionStyle, wordHighlight: project.wordHighlight, highlightKeywords: project.highlightKeywords, addEmojis: project.addEmojis, autoCensor: project.autoCensor, processingMode: project.processingMode, subjectTrack, autoReframe: project.autoReframe, aspectRatio: project.aspectRatio, fitBackground: project.fitBackground, minDuration: clipRange.min, maxDuration: clipRange.max, signal: controller.signal });
      }
      const viralPotential = Math.round((candidate.hookScore ?? candidate.score) * 0.4 + (candidate.valueScore ?? candidate.score) * 0.28 + (candidate.completenessScore ?? candidate.score) * 0.17 + candidate.score * 0.15);
      addClip({ id: clipId, projectId: project.id, title: candidate.title, reason: candidate.reason, queryMatch: project.clipPrompt ? candidate.queryMatch ?? null : null, viralPotential, hookScore: candidate.hookScore ?? null, completenessScore: candidate.completenessScore ?? null, valueScore: candidate.valueScore ?? null, start: candidate.start, end: candidate.end, subtitles: project.subtitles, sizeBytes: (await stat(file)).size, videoPath: file, previewPath: file.replace(/\.mp4$/, '.jpg'), createdAt: new Date().toISOString(), brollSources: broll.sources, brollError: broll.brollError, seriesKey: candidate.seriesKey ?? null, seriesPart: candidate.seriesPart ?? null, seriesTotal: candidate.seriesTotal ?? null, favorite: false, notInteresting: false });
    }
    updateProject(project.id, { status: 'completed', workerPid: null, workerHeartbeatAt: null });
  } catch (error) {
    const message = readableProcessingError(error);
    updateProject(project.id, controller.signal.aborted
      ? { status: 'cancelled', error: null, workerPid: null, workerHeartbeatAt: null }
      : { status: 'failed', error: message, workerPid: null, workerHeartbeatAt: null });
    throw new Error(message, { cause: error });
  } finally { clearInterval(heartbeat); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
