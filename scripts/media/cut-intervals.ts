import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { run } from './core';

export interface CutInterval { start: number; end: number }

export async function cutRenderedClip(inputPath: string, duration: number, cuts: CutInterval[], processingMode: 'eco' | 'fast') {
  if (!cuts.length) return inputPath;
  const keep: CutInterval[] = [];
  let cursor = 0;
  for (const cut of [...cuts].sort((a, b) => a.start - b.start)) {
    if (cut.start > cursor + 0.05) keep.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration - 0.05) keep.push({ start: cursor, end: duration });
  if (!keep.length) throw new Error('Нельзя удалить весь клип.');
  const filter = keep.map((part, index) => `[0:v]trim=start=${part.start.toFixed(3)}:end=${part.end.toFixed(3)},setpts=PTS-STARTPTS[v${index}];[0:a]atrim=start=${part.start.toFixed(3)}:end=${part.end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`).join(';') + `;${keep.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${keep.length}:v=1:a=1[v][a]`;
  const output = path.join(path.dirname(inputPath), `clip-${randomUUID()}.mp4`);
  const base = ['-nostdin', '-v', 'error', '-y', '-i', inputPath, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  try {
    try {
      await run('ffmpeg', [...base, '-c:v', processingMode === 'fast' ? 'h264_nvenc' : 'libx264', ...(processingMode === 'fast' ? ['-preset', 'p4'] : ['-preset', 'veryfast']), output], { timeoutMs: 600_000 });
    } catch (error) {
      if (processingMode !== 'fast') throw error;
      await run('ffmpeg', [...base, '-c:v', 'libx264', '-preset', 'veryfast', output], { timeoutMs: 600_000 });
    }
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', '0.5', '-i', output, '-frames:v', '1', output.replace(/\.mp4$/u, '.jpg')], { timeoutMs: 30_000 });
  } catch (error) {
    await Promise.all([output, output.replace(/\.mp4$/u, '.jpg')].map(file => rm(file, { force: true })));
    throw error;
  }
  return output;
}
