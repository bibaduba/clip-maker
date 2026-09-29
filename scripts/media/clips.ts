import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getYouTubeVideoId } from '../../src/lib/youtube';
import { requireDisk, run, writeJson } from './core';
import { selectClips, validateSegments } from './selection';
import { renderClip } from './render';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { video: { type: 'string' }, both: { type: 'boolean' }, 'no-subtitles': { type: 'boolean' }, count: { type: 'string', default: '2' } } });
  if (positionals.length !== 1 || (values.both && values['no-subtitles'])) throw new Error('Запуск: npm run media:clips -- <каталог benchmark> [--video <видео с начала исходника>] [--both | --no-subtitles] [--count 2]');
  const benchmark = path.resolve(positionals[0]);
  const transcript = JSON.parse(await readFile(path.join(benchmark, 'transcript.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(benchmark, 'source.json'), 'utf8'));
  if (transcript.sourceOffset !== 0 || !Number.isFinite(transcript.duration) || transcript.duration <= 0 || transcript.duration > 600 || getYouTubeVideoId(source.url) !== source.id) throw new Error('Несовместимые metadata: нужен начальный фрагмент YouTube до 10 минут.');
  const segments = validateSegments(transcript.segments);
  if (segments.at(-1)!.end > transcript.duration + 0.05) throw new Error('Расшифровка выходит за длительность аудио.');
  const root = path.resolve('storage'); await mkdir(root, { recursive: true }); await requireDisk(root);
  const lockPath = path.join(root, 'clips.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Обработка клипов уже запущена или остался clips.lock после аварии.'); });
  const output = path.join(root, 'clips', `${source.id}-${Date.now()}`);
  const completed: unknown[] = []; let stage = 'selecting';
  const started = Date.now();
  const state = async (error?: string) => { await writeJson(path.join(output, 'status.json'), { stage, completed, ...(error ? { error } : {}) }); };
  try {
    await lock.writeFile(String(process.pid)); await mkdir(output, { recursive: true }); await state();
    console.log('ИИ выбирает моменты локально…');
    const selectedAt = Date.now();
    const candidates = await selectClips(segments, output, Number(values.count), controller.signal);
    await writeJson(path.join(output, 'selection.json'), { provider: 'local-llama.cpp', model: process.env.CLIP_LLM_MODEL ?? 'Qwen3-4B-Q4_K_M', seconds: (Date.now() - selectedAt) / 1000, candidates });
    if (!candidates.length) { stage = 'no_candidates'; await state(); console.log('Подходящие фрагменты не найдены.'); return; }
    let videoPath = values.video ? path.resolve(values.video) : '';
    if (!videoPath) {
      stage = 'downloading'; await state(); console.log('Загрузка видео…');
      const result = await run('yt-dlp', ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '30', '--retries', '2', '--js-runtimes', 'node', '-f', 'bv*[height<=720]+ba/b[height<=720]', '--download-sections', `*0-${transcript.duration}`, '--max-filesize', '512M', '--merge-output-format', 'mp4', '-o', path.join(output, 'source.%(ext)s'), '--print', 'after_move:filepath', '--', `https://www.youtube.com/watch?v=${source.id}`], { signal: controller.signal, timeoutMs: 600_000 });
      videoPath = result.trim().split('\n').at(-1) ?? '';
      if (path.dirname(path.resolve(videoPath)) !== output) throw new Error('Неожиданный путь загрузки.');
    }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', videoPath], { signal: controller.signal }));
    if (!probe.streams?.some((s: { codec_type: string }) => s.codec_type === 'video') || !probe.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio') || !Number.isFinite(Number(probe.format?.duration)) || Number(probe.format.duration) + 0.5 < Math.max(...candidates.map(c => c.end))) throw new Error('Исходник не содержит нужный интервал видео и звука.');
    stage = 'rendering'; await state();
    for (const [index, candidate] of candidates.entries()) {
      for (const subtitles of values.both ? [true, false] : [!values['no-subtitles']]) {
        await requireDisk(root);
        console.log(`Монтаж ${index + 1}/${candidates.length}, субтитры ${subtitles ? 'включены' : 'выключены'}`);
        const file = await renderClip({ sourcePath: videoPath, outputDirectory: path.join(output, `clip-${index + 1}-${subtitles ? 'captions' : 'clean'}`), start: candidate.start, end: candidate.end, segments, subtitles, signal: controller.signal });
        completed.push({ ...candidate, subtitles, file, preview: file.replace(/\.mp4$/, '.jpg'), subtitleTiming: subtitles ? 'approximate-phrase' : null });
        await state();
      }
    }
    await writeJson(path.join(output, 'result.json'), { sourceVideoId: source.id, analyzedSeconds: transcript.duration, totalSeconds: (Date.now() - started) / 1000, qualityReviewed: false, clips: completed });
    stage = 'completed'; await state(); console.log(`Готово: ${output}`);
  } catch (error) { stage = controller.signal.aborted ? 'cancelled' : 'failed'; await state(String(error)); throw error; }
  finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
