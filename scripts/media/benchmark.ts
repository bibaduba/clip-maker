import { readFile, writeFile, mkdir, open, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getYouTubeVideoId } from '../../src/lib/youtube';
import { normalizeTranscript, requireDisk, run, writeJson } from './core';

const root = path.resolve('storage');
const model = path.resolve(process.env.WHISPER_MODEL ?? 'storage/models/ggml-small.bin');
const cli = process.env.WHISPER_CLI ?? 'whisper-cli';
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const options = { signal: controller.signal };

async function main() {
  const id = getYouTubeVideoId(process.argv[2] ?? '');
  if (!id) throw new Error('Запуск: npm run media:benchmark -- "https://www.youtube.com/watch?v=VIDEO_ID" [секунды 10–180]');
  const seconds = Number(process.argv[3] ?? 180);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 180) throw new Error('Длительность теста: целое число от 10 до 180 секунд.');
  await mkdir(root, { recursive: true });
  await requireDisk(root);
  await stat(model).catch(() => { throw new Error(`Не найдена модель ${model}. См. docs/local-media.md.`); });
  // Global lock is intentionally exclusive; never auto-remove another process's lock.
  const lockPath = path.join(root, 'benchmark.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Другой тест уже запущен или остался benchmark.lock после сбоя. См. документацию.'); });
  const directory = path.join(root, 'benchmarks', `${id}-${Date.now()}`);
  let stage = 'preflight';
  const started = Date.now();
  try {
    await lock.writeFile(String(process.pid));
    await mkdir(directory, { recursive: true });
    const state = async () => { console.log(`Этап: ${stage}`); await writeJson(path.join(directory, 'status.json'), { stage, videoId: id, startedAt: new Date(started).toISOString() }); };
    await state();
    const downloader = await run('yt-dlp', ['--version'], options);
    const ffmpeg = (await run('ffmpeg', ['-version'], options)).split('\n')[0];
    const canonicalUrl = `https://www.youtube.com/watch?v=${id}`;
    // Ignore machine-wide yt-dlp config; do not read browser cookies or credentials.
    const common = ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '30', '--retries', '2', '--js-runtimes', 'node'];
    stage = 'metadata'; await state();
    const metadata = JSON.parse(await run('yt-dlp', [...common, '--dump-single-json', '--skip-download', '--', canonicalUrl], options));
    if (metadata.id !== id || metadata.is_live || metadata.live_status === 'is_upcoming') throw new Error('Нужна доступная завершённая запись YouTube.');
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > 7200) throw new Error('Для первого теста нужен ролик длительностью до 120 минут.');
    const sampleSeconds = Math.min(seconds, metadata.duration);
    await writeJson(path.join(directory, 'source.json'), { id, title: metadata.title, duration: metadata.duration, url: canonicalUrl });
    stage = 'downloading'; await state();
    await run('yt-dlp', [...common, '-f', 'bestaudio/best', '--download-sections', `*0-${sampleSeconds}`, '--max-filesize', '256M', '--output', path.join(directory, 'source.%(ext)s'), '--print', 'after_move:filepath', '--', canonicalUrl], { ...options, timeoutMs: 600_000, log: true }).then(async (stdout) => {
      const downloaded = stdout.trim().split('\n').at(-1);
      if (!downloaded || path.dirname(path.resolve(downloaded)) !== directory) throw new Error('Загрузчик не вернул ожидаемый файл.');
      stage = 'extracting'; await state();
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', downloaded, '-t', String(sampleSeconds), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(directory, 'audio.wav')], { ...options, timeoutMs: 120_000 });
    });
    const audio = path.join(directory, 'audio.wav');
    const duration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audio], options));
    if (!Number.isFinite(duration) || duration <= 0 || duration > seconds + 1) throw new Error('Некорректная длительность аудио.');
    stage = 'transcribing'; await state();
    const asrStarted = Date.now();
    await run(cli, ['-m', model, '-f', audio, '-l', 'ru', '-oj', '-of', path.join(directory, 'whisper'), '-t', '4'], { ...options, timeoutMs: 1_200_000, log: true });
    const asrSeconds = (Date.now() - asrStarted) / 1000;
    const raw = JSON.parse(await readFile(path.join(directory, 'whisper.json'), 'utf8'));
    const segments = normalizeTranscript(raw, duration);
    await writeJson(path.join(directory, 'transcript.json'), { language: 'ru', sourceOffset: 0, duration, segments });
    await writeFile(path.join(directory, 'transcript.txt'), segments.map(s => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.text}${s.truncated ? ' [обрезано концом теста]' : ''}`).join('\n\n') + '\n');
    await writeJson(path.join(directory, 'report.json'), { videoId: id, title: metadata.title, sampleSeconds: duration, asrSeconds, realtimeFactor: asrSeconds / duration, totalSeconds: (Date.now() - started) / 1000, model: path.basename(model), modelSha256: createHash('sha256').update(await readFile(model)).digest('hex'), engine: raw.systeminfo ?? null, downloader: downloader.trim(), ffmpeg, segmentCount: segments.length, qualityReviewed: false });
    stage = 'completed'; await state();
    console.log(`Результаты: ${directory}\nРаспознавание: ${asrSeconds.toFixed(1)} с на ${duration.toFixed(1)} с аудио. Качество нужно проверить вручную.`);
  } catch (error) {
    await writeJson(path.join(directory, 'status.json'), { stage: controller.signal.aborted ? 'cancelled' : 'failed', failedStage: stage, error: String(error) });
    throw error;
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
