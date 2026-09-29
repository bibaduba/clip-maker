import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AspectRatio } from '../../src/lib/project-types';

export interface StockVideo {
  provider: 'pexels';
  providerId: number;
  pageUrl: string;
  creator: string;
  creatorUrl: string;
  downloadUrl: string;
  alternativeDownloadUrls: string[];
  width: number;
  height: number;
  duration: number;
  license: 'Pexels License';
}
export interface StockImage {
  provider: 'pexels'; providerId: number; pageUrl: string; creator: string; creatorUrl: string;
  downloadUrl: string; alternativeDownloadUrls: string[]; width: number; height: number; license: 'Pexels License';
}

const allowedDownloadHosts = ['pexels.com', 'vimeo.com', 'vimeocdn.com'];
function safeDownloadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedDownloadHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Pexels вернул недопустимый адрес видео.');
  return url;
}

function targetShape(aspectRatio: AspectRatio) {
  if (aspectRatio === '16:9') return 'landscape';
  if (aspectRatio === '1:1') return 'square';
  return 'portrait';
}

export async function searchPexelsVideos(query: string, aspectRatio: AspectRatio, minimumDuration: number, signal?: AbortSignal): Promise<StockVideo[]> {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) throw new Error('PEXELS_API_KEY не настроен.');
  const url = new URL('https://api.pexels.com/v1/videos/search');
  url.search = new URLSearchParams({ query, orientation: targetShape(aspectRatio), size: 'medium', locale: 'ru-RU', per_page: '10' }).toString();
  const response = await fetch(url, { headers: { Authorization: apiKey }, signal });
  if (!response.ok) throw new Error(`Pexels API: HTTP ${response.status}.`);
  const body = await response.json() as { videos?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.videos)) throw new Error('Pexels вернул некорректный список видео.');
  const candidates: StockVideo[] = [];
  for (const raw of body.videos) {
    const files = Array.isArray(raw.video_files) ? raw.video_files as Array<Record<string, unknown>> : [];
    const suitableFiles = files.filter(file => file.file_type === 'video/mp4' && Number(file.width) >= 540 && Number(file.height) >= 540 && typeof file.link === 'string').sort((a, b) => Math.abs(Number(a.width) * Number(a.height) - 1_500_000) - Math.abs(Number(b.width) * Number(b.height) - 1_500_000));
    const suitable = suitableFiles[0];
    const user = raw.user as Record<string, unknown> | undefined;
    if (!suitable || !Number.isFinite(Number(raw.id)) || !Number.isFinite(Number(raw.duration)) || Number(raw.duration) < minimumDuration || typeof raw.url !== 'string') continue;
    safeDownloadUrl(String(suitable.link));
    const alternativeDownloadUrls = [...new Set(suitableFiles.slice(1, 5).map(file => String(file.link)))];
    alternativeDownloadUrls.forEach(url => safeDownloadUrl(url));
    candidates.push({ provider: 'pexels', providerId: Number(raw.id), pageUrl: raw.url, creator: typeof user?.name === 'string' ? user.name : 'Pexels creator', creatorUrl: typeof user?.url === 'string' ? user.url : 'https://www.pexels.com', downloadUrl: String(suitable.link), alternativeDownloadUrls, width: Number(suitable.width), height: Number(suitable.height), duration: Number(raw.duration), license: 'Pexels License' });
  }
  return candidates.slice(0, 4);
}

export async function searchPexelsVideo(query: string, aspectRatio: AspectRatio, minimumDuration: number, signal?: AbortSignal): Promise<StockVideo | null> {
  return (await searchPexelsVideos(query, aspectRatio, minimumDuration, signal))[0] ?? null;
}

export async function searchPexelsImages(query: string, aspectRatio: AspectRatio, signal?: AbortSignal): Promise<StockImage[]> {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) throw new Error('PEXELS_API_KEY не настроен.');
  const url = new URL('https://api.pexels.com/v1/search');
  url.search = new URLSearchParams({ query, orientation: targetShape(aspectRatio), size: 'large', locale: 'ru-RU', per_page: '8' }).toString();
  const response = await fetch(url, { headers: { Authorization: apiKey }, signal });
  if (!response.ok) throw new Error(`Pexels Images API: HTTP ${response.status}.`);
  const body = await response.json() as { photos?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.photos)) throw new Error('Pexels вернул некорректный список изображений.');
  return body.photos.flatMap(raw => {
    const src = raw.src as Record<string, unknown> | undefined; const user = raw.photographer;
    const links = [src?.large2x, src?.large, src?.portrait, src?.landscape].filter((value): value is string => typeof value === 'string');
    if (!links.length || !Number.isFinite(Number(raw.id)) || typeof raw.url !== 'string') return [];
    links.forEach(link => safeDownloadUrl(link));
    return [{ provider: 'pexels' as const, providerId: Number(raw.id), pageUrl: raw.url, creator: typeof user === 'string' ? user : 'Pexels creator', creatorUrl: typeof raw.photographer_url === 'string' ? raw.photographer_url : 'https://www.pexels.com', downloadUrl: links[0], alternativeDownloadUrls: [...new Set(links.slice(1))], width: Number(raw.width), height: Number(raw.height), license: 'Pexels License' as const }];
  }).slice(0, 4);
}

export async function downloadStockMedia(video: StockVideo | StockImage, destination: string, signal?: AbortSignal) {
  await mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  const sources = [video.downloadUrl, ...(video.alternativeDownloadUrls ?? [])];
  let lastError: unknown;
  for (const candidate of sources) {
    const source = safeDownloadUrl(candidate);
    await rm(partial, { force: true });
    try {
      const response = await fetch(source, { redirect: 'follow', signal, headers: { Accept: 'video/mp4,video/*;q=0.9,image/*;q=0.8,*/*;q=0.1', 'User-Agent': 'Mozilla/5.0 ClipMaker/1.0', Referer: video.pageUrl } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      safeDownloadUrl(response.url);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > 250 * 1024 * 1024) throw new Error('файл превышает 250 МБ');
      let received = 0;
      const limiter = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; callback(received > 250 * 1024 * 1024 ? new Error('файл превышает 250 МБ') : null, chunk); } });
      await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(partial), { signal });
      await rename(partial, destination);
      return destination;
    } catch (error) {
      lastError = error;
      await rm(partial, { force: true });
      if (signal?.aborted) throw error;
    }
  }
  throw new Error(`Не удалось скачать B-roll ни в одном качестве: ${lastError instanceof Error ? lastError.message : String(lastError)}.`);
}

export const downloadStockVideo = downloadStockMedia;
