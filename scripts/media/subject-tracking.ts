import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from './core';
import type { SubjectPoint } from './render';

function validPoint(value: unknown): value is SubjectPoint {
  const point = value as SubjectPoint;
  return Boolean(point) && Number.isFinite(point.time) && point.time >= 0 && Number.isFinite(point.centerX) && point.centerX >= 0 && point.centerX <= 1 && Number.isFinite(point.confidence) && point.confidence >= 0 && point.confidence <= 1 && (point.speakerId === undefined || Number.isInteger(point.speakerId)) && (point.sceneCut === undefined || typeof point.sceneCut === 'boolean');
}

function smooth(points: SubjectPoint[]) {
  let center = 0.5;
  let speakerId: number | undefined;
  return points.map(point => {
    if (point.sceneCut) center = point.centerX;
    const speakerChanged = speakerId !== undefined && point.speakerId !== undefined && speakerId !== point.speakerId;
    const distance = Math.abs(point.centerX - center);
    // Confirmed speaker changes should feel like an intentional cut/pan, not a
    // slow chase. Tiny detector movement is ignored to avoid camera vibration.
    const influence = point.sceneCut ? 1 : speakerChanged ? 0.82 : distance < 0.025 ? 0 : Math.min(0.68, Math.max(0.34, point.confidence * 0.62));
    center += (point.centerX - center) * influence;
    speakerId = point.speakerId ?? speakerId;
    return { ...point, centerX: Math.min(0.92, Math.max(0.08, center)) };
  });
}

export async function detectSubjectTrack(sourcePath: string, directory: string, duration: number, processingMode: 'eco' | 'fast', signal?: AbortSignal): Promise<SubjectPoint[]> {
  const cache = path.join(directory, 'subject-track.json');
  if (await access(cache).then(() => true).catch(() => false)) {
    const stored = JSON.parse(await readFile(cache, 'utf8')) as { version?: number; detector?: string; points?: unknown[] };
    if (stored.version === 4 && stored.detector !== 'center-fallback') return Array.isArray(stored.points) ? stored.points.filter(validPoint) : [];
  }
  const interval = processingMode === 'eco' ? 0.75 : 0.5;
  const frames = await mkdtemp(path.join(tmpdir(), 'clip-subject-'));
  try {
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-threads', processingMode === 'eco' ? '2' : '4', '-i', sourcePath, '-t', String(duration), '-vf', `fps=1/${interval},scale=320:-2`, '-q:v', '6', path.join(frames, 'frame-%05d.jpg')], { signal, timeoutMs: 600_000 });
    const defaultPython = path.resolve(process.platform === 'win32' ? '.venv-asr/Scripts/python.exe' : '.venv-asr/bin/python');
    const detector = process.platform === 'darwin' ? 'apple-vision-face-rectangles' : 'opencv-active-speaker-v1';
    const output = process.platform === 'darwin'
      ? await run('swift', [path.resolve('scripts/media/detect-faces.swift'), frames, String(interval)], { signal, timeoutMs: 600_000 })
      : await run(process.env.WHISPERX_PYTHON ?? defaultPython, [path.resolve('scripts/media/detect-faces.py'), frames, String(interval)], { signal, timeoutMs: 600_000 });
    const parsed = JSON.parse(output) as unknown;
    const points = smooth(Array.isArray(parsed) ? parsed.filter(validPoint) : []);
    await writeJson(cache, { version: 4, interval, detector, points });
    return points;
  } catch (error) {
    if (signal?.aborted) throw error;
    await writeJson(cache, { version: 1, interval, detector: 'center-fallback', points: [] });
    return [];
  } finally {
    await rm(frames, { recursive: true, force: true });
  }
}
