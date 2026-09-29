import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { currentUser } from '@/server/auth';
import { getOwnedProject } from '@/server/projects';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/u.test(id) || !getOwnedProject(id, user.id)) return new Response('Not found', { status: 404 });
  const file = path.resolve('storage/projects', id, 'source.mp4');
  let info;
  try { info = await stat(file); } catch { return new Response('Not found', { status: 404 }); }
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix === null ? Number(match[1]) : Math.max(0, info.size - suffix);
    const end = suffix === null && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= info.size)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(info.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' } });
}
