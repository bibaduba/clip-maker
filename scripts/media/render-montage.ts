import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { run, type Segment } from './core';
import { renderClip, type SubjectPoint } from './render';
import type { MontagePlan } from './montage-plan';
import type { ProjectRecord } from '../../src/lib/project-types';

export async function renderMontage(sourcePath: string, outputDirectory: string, plan: MontagePlan, transcript: Segment[], project: ProjectRecord, subjectTrack: SubjectPoint[] = [], signal?: AbortSignal) {
  const rendered: string[] = [];
  const temporary: string[] = [];
  const output = path.join(outputDirectory, `clip-${randomUUID()}.mp4`);
  try {
    for (const piece of plan.pieces) {
      const base = await renderClip({ sourcePath, outputDirectory, start: piece.start, end: piece.end, segments: transcript, subtitles: project.subtitles, subtitleColor: project.subtitleColor, captionStyle: project.captionStyle, wordHighlight: project.wordHighlight, highlightKeywords: project.highlightKeywords, addEmojis: project.addEmojis, autoCensor: project.autoCensor, processingMode: project.processingMode, subjectTrack, autoReframe: project.autoReframe, aspectRatio: project.aspectRatio, fitBackground: project.fitBackground, punchIn: piece.effect === 'punch', flash: piece.effect === 'flash', accentArrow: piece.effect === 'arrow' && piece.arrowX !== undefined && piece.arrowY !== undefined ? { x: piece.arrowX, y: piece.arrowY } : null, audioEdgeFade: true, minDuration: 1, maxDuration: 600, signal });
      temporary.push(base);
      if (piece.effect === 'freeze') {
        const frozen = path.join(outputDirectory, `freeze-${randomUUID()}.mp4`);
        temporary.push(frozen);
        await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', base, '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=0.30[v];[0:a]apad=pad_dur=0.30[a]', '-map', '[v]', '-map', '[a]', '-t', String(piece.end - piece.start + 0.30), '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', frozen], { signal, timeoutMs: 180_000 });
        rendered.push(frozen);
      } else rendered.push(base);
    }
    const inputs = rendered.flatMap(file => ['-i', file]);
    const chain = rendered.map((_, index) => `[${index}:v][${index}:a]`).join('') + `concat=n=${rendered.length}:v=1:a=1[v][joined];[joined]loudnorm=I=-16:TP=-1.5:LRA=11[a]`;
    const args = ['-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', chain, '-map', '[v]', '-map', '[a]', '-c:v', project.processingMode === 'fast' ? 'h264_nvenc' : 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
    try { await run('ffmpeg', args, { signal, timeoutMs: 600_000 }); }
    catch (error) {
      if (project.processingMode !== 'fast') throw error;
      args[args.indexOf('h264_nvenc')] = 'libx264';
      await run('ffmpeg', args, { signal, timeoutMs: 600_000 });
    }
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', '0.5', '-i', output, '-frames:v', '1', output.replace(/\.mp4$/u, '.jpg')], { signal, timeoutMs: 30_000 });
    await stat(output);
    return output;
  } catch (error) {
    await Promise.all([output, output.replace(/\.mp4$/u, '.jpg')].map(file => rm(file, { force: true })));
    throw error;
  } finally {
    await Promise.all(temporary.flatMap(file => [file, file.replace(/\.mp4$/u, '.jpg')]).map(file => rm(file, { force: true })));
  }
}
