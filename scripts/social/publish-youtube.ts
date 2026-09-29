import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getPublication, getYouTubeRefreshToken, updatePublication } from '../../src/server/social';

const publicationId = process.argv[2];
async function main() {
  const publication = getPublication(publicationId);
  if (!publication || publication.platform !== 'youtube') throw new Error('Публикация не найдена.');
  updatePublication(publicationId, { status: 'uploading', workerPid: process.pid, error: null });
  try {
    const refreshToken = getYouTubeRefreshToken(String(publication.user_id));
    if (!refreshToken) throw new Error('Канал YouTube не подключён.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
    const tokenBody = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody.error_description || 'Не удалось обновить доступ YouTube.');
    const clip = getPublication(publicationId) as Record<string, unknown>;
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage', 'clip-maker.sqlite'));
    const asset = db.prepare('SELECT video_path FROM clips WHERE id=?').get(String(clip.clip_id)) as { video_path?: string } | undefined;
    db.close();
    if (!asset?.video_path) throw new Error('Файл клипа не найден.');
    const filePath = path.resolve(asset.video_path); const size = (await stat(filePath)).size;
    if (size <= 0 || size > 512 * 1024 * 1024) throw new Error('Размер клипа для публикации должен быть до 512 МБ.');
    const scheduledAt = publication.scheduled_at ? String(publication.scheduled_at) : null;
    let tags: string[] = [];
    try { const parsed = JSON.parse(String(publication.tags_json ?? '[]')); if (Array.isArray(parsed)) tags = parsed.filter(tag => typeof tag === 'string'); } catch { /* Damaged optional tags must not block an upload. */ }
    const metadata = { snippet: { title: String(publication.title), description: String(publication.description), tags, categoryId: '23', defaultLanguage: 'ru', defaultAudioLanguage: 'ru' }, status: { privacyStatus: scheduledAt ? 'private' : String(publication.privacy), ...(scheduledAt ? { publishAt: scheduledAt } : {}), selfDeclaredMadeForKids: false } };
    const initiate = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(metadata) });
    const uploadUrl = initiate.headers.get('location');
    if (!initiate.ok || !uploadUrl) throw new Error(`YouTube не создал сессию загрузки: HTTP ${initiate.status}.`);
    const upload = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: await readFile(filePath) });
    const result = await upload.json() as { id?: string; error?: { message?: string } };
    if (!upload.ok || !result.id) throw new Error(result.error?.message || `Ошибка загрузки YouTube: HTTP ${upload.status}.`);
    updatePublication(publicationId, { status: 'published', remoteId: result.id, workerPid: null, error: null });
  } catch (error) {
    updatePublication(publicationId, { status: 'failed', workerPid: null, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) });
    throw error;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
