import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run } from './core';

export interface BrollAsset {
  path: string;
  start: number;
  end: number;
  kind: 'video' | 'image';
  layout: 'full' | 'split-bottom' | 'pip';
  motion: 'none' | 'slow-zoom' | 'pan';
}

export async function applyBroll(input: string, outputDirectory: string, width: number, height: number, assets: BrollAsset[], processingMode: 'eco' | 'fast', signal?: AbortSignal) {
  if (!assets.length) return input;
  await mkdir(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `clip-broll-${randomUUID()}.mp4`);
  const partial = output.replace(/\.mp4$/u, '.partial.mp4');
  const args = ['-nostdin', '-v', 'error', '-y', '-i', path.resolve(input)];
  for (const asset of assets) args.push(...(asset.kind === 'image' ? ['-loop', '1'] : ['-stream_loop', '-1']), '-i', path.resolve(asset.path));
  const filters: string[] = [];
  let base = '0:v';
  assets.forEach((asset, index) => {
    const duration = asset.end - asset.start;
    if (!Number.isFinite(asset.start) || !Number.isFinite(asset.end) || asset.start < 0 || duration < 2 || duration > 7) throw new Error('Некорректный интервал B-roll.');
    if (!['video', 'image'].includes(asset.kind) || !['full', 'split-bottom', 'pip'].includes(asset.layout) || !['none', 'slow-zoom', 'pan'].includes(asset.motion)) throw new Error('Некорректный стиль B-roll.');
    const overlay = `broll${index}`; const result = `mix${index}`;
    const targetWidth = asset.layout === 'pip' ? Math.round(width * 0.68) : width;
    const targetHeight = asset.layout === 'full' ? height : asset.layout === 'split-bottom' ? Math.round(height * 0.5) : Math.round(height * 0.38);
    const movement = asset.kind === 'image' && asset.motion !== 'none'
      ? `,zoompan=z='min(zoom+0.0012,1.09)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${targetWidth}x${targetHeight}:fps=30`
      : '';
    const fadeOut = Math.max(0.1, duration - 0.28).toFixed(3);
    const border = asset.layout === 'pip' ? ',pad=iw+8:ih+8:4:4:color=white@0.88' : '';
    filters.push(`[${index + 1}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}${movement},trim=duration=${duration.toFixed(3)},format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${fadeOut}:d=0.25:alpha=1${border},setpts=PTS-STARTPTS+${asset.start.toFixed(3)}/TB[${overlay}]`);
    let underlay = base;
    if (asset.layout === 'split-bottom') {
      const carry = `carry${index}`; const topRaw = `topraw${index}`; const top = `top${index}`; const staged = `staged${index}`;
      filters.push(`[${base}]split=2[${carry}][${topRaw}]`);
      filters.push(`[${topRaw}]scale=${width}:${targetHeight}:force_original_aspect_ratio=increase,crop=${width}:${targetHeight},format=rgba,fade=t=in:st=${asset.start.toFixed(3)}:d=0.25:alpha=1,fade=t=out:st=${Math.max(asset.start + 0.1, asset.end - 0.28).toFixed(3)}:d=0.25:alpha=1[${top}]`);
      filters.push(`[${carry}][${top}]overlay=0:0:enable='between(t,${asset.start.toFixed(3)},${asset.end.toFixed(3)})':eof_action=pass[${staged}]`);
      underlay = staged;
    }
    const position = asset.layout === 'full' ? '0:0' : asset.layout === 'split-bottom' ? `0:${height - targetHeight}` : `(W-w)/2:H-h-70`;
    filters.push(`[${underlay}][${overlay}]overlay=${position}:enable='between(t,${asset.start.toFixed(3)},${asset.end.toFixed(3)})':eof_action=pass[${result}]`);
    base = result;
  });
  try {
    await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', `[${base}]`, '-map', '0:a:0?', '-c:v', 'libx264', '-preset', processingMode === 'eco' ? 'ultrafast' : 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', partial], { signal, timeoutMs: 600_000 });
    if ((await stat(partial)).size < 1024) throw new Error('B-roll рендер получился пустым.');
    await rename(partial, output);
    return output;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
