import { spawn } from 'node:child_process';
import { mkdir, statfs, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

export async function requireDisk(directory: string, bytes = (() => { const value = Number(process.env.MEDIA_MIN_FREE_GB); return (Number.isFinite(value) && value > 0 ? value : 3) * 1024 ** 3; })()) {
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < bytes) throw new Error('Недостаточно места: требуется минимум 3 ГБ свободного диска.');
}

export function run(command: string, args: string[], options: { timeoutMs?: number; signal?: AbortSignal; log?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Обработка отменена.')); return; }
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else if (child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.unref();
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error; }
    };
    const terminate = (reason: Error) => {
      if (failure) return;
      failure = reason;
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 5_000);
    };
    const timer = setTimeout(() => terminate(new Error(`${command}: превышено время выполнения.`)), options.timeoutMs ?? 120_000);
    const abort = () => terminate(new Error('Обработка отменена.'));
    child.on('error', (error) => { failure ??= new Error(`${command}: ${error.message}`); });
    child.stdout.on('data', (data: Buffer) => {
      if (failure) return;
      stdout += data.toString();
      if (stdout.length > 8_000_000) terminate(new Error('Вывод процесса превысил лимит.'));
    });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16_000); if (options.log) process.stderr.write(data); });
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('close', (code) => {
      // Reap any remaining descendant even if it closed its inherited pipes.
      if (failure) kill('SIGKILL');
      clearTimeout(timer); clearTimeout(forceTimer); options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command}: код ${code}. ${stderr.slice(-3000)}`));
      else resolve(stdout);
    });
  });
}

export interface TimedToken { start: number; end: number; text: string; probability?: number; speaker?: string }
export interface Segment { id: number; start: number; end: number; text: string; tokens?: TimedToken[]; words?: TimedToken[]; truncated?: boolean; speaker?: string }

/** Removes Whisper timestamp/control markers without changing token boundaries. */
export function stripTranscriptControlTokens(text: string): string {
  return text
    .replace(/\[\s*_?TT_?\d+\s*\]/giu, ' ')
    .replace(/<\|[^|>]+\|>/gu, ' ');
}

/** Normalizes a complete transcript phrase after control markers are removed. */
export function cleanTranscriptText(text: string): string {
  return stripTranscriptControlTokens(text)
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTranscript(raw: unknown, duration: number): Segment[] {
  const data = raw as { transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string; tokens?: Array<{ offsets?: { from?: number; to?: number }; text?: string; p?: number }> }> };
  if (!Array.isArray(data?.transcription)) throw new Error('Некорректный JSON распознавания.');
  let previousEnd = 0;
  const segments: Segment[] = [];
  for (const [index, segment] of data.transcription.entries()) {
    const start = Number(segment.offsets?.from) / 1000;
    const end = Number(segment.offsets?.to) / 1000;
    const text = cleanTranscriptText(segment.text ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || start >= duration || end <= start || (end > duration + 0.5 && (index !== data.transcription.length - 1 || end > duration + 5))) throw new Error('Некорректные временные метки распознавания.');
    previousEnd = end;
    if (text && !/^\[.*\]$/.test(text)) {
      const tokens = (segment.tokens ?? []).flatMap(token => {
        const tokenStart = Number(token.offsets?.from) / 1000;
        const tokenEnd = Number(token.offsets?.to) / 1000;
        const tokenText = stripTranscriptControlTokens(token.text ?? '');
        if (!tokenText.trim() || /^\[_.*_\]$/u.test(tokenText.trim()) || !Number.isFinite(tokenStart) || !Number.isFinite(tokenEnd) || tokenStart < Math.max(0, start - 0.5) || tokenEnd < tokenStart || tokenStart > Math.min(duration, end + 0.5)) return [];
        return [{ start: tokenStart, end: Math.min(Math.max(tokenEnd, tokenStart + 0.02), duration), text: tokenText, ...(Number.isFinite(token.p) ? { probability: Number(token.p) } : {}) }];
      });
      segments.push({ id: segments.length, start, end: Math.min(end, duration), text, ...(tokens.length ? { tokens } : {}), ...(end > duration + 0.05 ? { truncated: true } : {}) });
    }
  }
  if (!segments.length) throw new Error('Не найдено достаточно речи.');
  return segments;
}
