import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { getClipAsset, getOwnedClipSource } from '@/server/projects';
import { currentUser } from '@/server/auth';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; asset: string }> }) {
  const user = await currentUser(); if (!user) return new Response('Unauthorized', { status: 401 });
  const { id, asset } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !['video', 'preview', 'source'].includes(asset)) return new Response('Not found', { status: 404 });
  const file = asset === 'source' ? getOwnedClipSource(id, user.id) : getClipAsset(id, asset as 'video' | 'preview', user.id);
  const root = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'projects') + path.sep;
  if (!file || !path.resolve(file).startsWith(root)) return new Response('Not found', { status: 404 });
  let info; try { info = await stat(file); } catch { return new Response('Not found', { status: 404 }); }
  const type = asset === 'preview' ? 'image/jpeg' : 'video/mp4';
  const range = request.headers.get('range');
  if (asset !== 'preview' && range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= info.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' } });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': type, 'Content-Length': String(info.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ...(asset !== 'preview' ? { 'Content-Disposition': `inline; filename="clip-${id}.mp4"` } : {}) } });
}
