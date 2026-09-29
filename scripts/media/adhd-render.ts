import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run } from './core';

export async function applyAdhdGameplay(mainVideo: string, gameplayVideo: string, outputDirectory: string, gameplayOffset: number, processingMode: 'eco' | 'fast', mainPosition: 'left' | 'center' | 'right' = 'center', signal?: AbortSignal) {
  await mkdir(outputDirectory, { recursive: true });
  const duration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mainVideo], { signal }));
  const gameplayDuration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', gameplayVideo], { signal }));
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(gameplayDuration) || gameplayDuration <= 0) throw new Error('Некорректное видео для СДВГ-компоновки.');
  const offset = Math.max(0, gameplayOffset % gameplayDuration);
  const partial = path.join(outputDirectory, `adhd-${randomUUID()}.partial.mp4`);
  const final = partial.replace('.partial.mp4', '.mp4');
  const mainHeight = 410;
  const gameplayHeight = 1280 - mainHeight;
  const mainX = mainPosition === 'left' ? '0' : mainPosition === 'right' ? 'iw-ow' : '(iw-ow)/2';
  // The smaller upper panel matches common ADHD layouts. Giving gameplay the
  // taller panel reveals more of a portrait source and therefore needs much
  // less zoom/cropping than an even 50/50 split.
  const filter = `[0:v]scale=720:${mainHeight}:force_original_aspect_ratio=increase,crop=720:${mainHeight}:${mainX}:(ih-oh)/2,setsar=1[main];[1:v]scale=720:${gameplayHeight}:force_original_aspect_ratio=increase,crop=720:${gameplayHeight}:(iw-ow)/2:ih-oh,setsar=1[game];[main][game]vstack=inputs=2[out]`;
  try {
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', mainVideo, '-stream_loop', '-1', '-ss', String(offset), '-i', gameplayVideo, '-t', String(duration), '-filter_complex', filter, '-map', '[out]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', processingMode === 'eco' ? 'ultrafast' : 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', partial], { signal, timeoutMs: 600_000 });
    if ((await stat(partial)).size < 1024) throw new Error('Не удалось собрать СДВГ-компоновку.');
    await rename(partial, final);
    return final;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
