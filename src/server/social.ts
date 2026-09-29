import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const storageRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage');
let database: DatabaseSync | undefined;
function db() {
  if (database) return database;
  mkdirSync(storageRoot, { recursive: true });
  const opened = new DatabaseSync(path.join(storageRoot, 'clip-maker.sqlite'));
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS social_connections (
  user_id TEXT NOT NULL, platform TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, clip_id TEXT NOT NULL, platform TEXT NOT NULL,
  status TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, privacy TEXT NOT NULL,
  scheduled_at TEXT, remote_id TEXT, error TEXT, worker_pid INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS publications_clip ON publications(clip_id, platform);`);
  const publicationColumns = opened.prepare('PRAGMA table_info(publications)').all() as Array<{ name: string }>;
  if (!publicationColumns.some(column => column.name === 'tags_json')) opened.exec("ALTER TABLE publications ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
  database = opened;
  return opened;
}

function encryptionKey() {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('Не настроен ключ шифрования подключений.');
  return createHash('sha256').update(secret).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(item => item.toString('base64url')).join('.');
}
function decrypt(value: string) {
  const [iv, tag, encrypted] = value.split('.').map(item => Buffer.from(item, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Повреждено подключение YouTube.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function saveYouTubeConnection(userId: string, refreshToken: string) {
  const now = new Date().toISOString();
  db().prepare(`INSERT INTO social_connections (user_id, platform, encrypted_refresh_token, created_at, updated_at)
    VALUES (?, 'youtube', ?, ?, ?) ON CONFLICT(user_id, platform) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, updated_at=excluded.updated_at`).run(userId, encrypt(refreshToken), now, now);
}
export function hasYouTubeConnection(userId: string) { return Boolean(db().prepare("SELECT 1 FROM social_connections WHERE user_id = ? AND platform = 'youtube'").get(userId)); }
export function getYouTubeRefreshToken(userId: string) {
  const row = db().prepare("SELECT encrypted_refresh_token token FROM social_connections WHERE user_id = ? AND platform = 'youtube'").get(userId) as { token?: string } | undefined;
  return row?.token ? decrypt(row.token) : null;
}
export function disconnectYouTube(userId: string) { db().prepare("DELETE FROM social_connections WHERE user_id = ? AND platform = 'youtube'").run(userId); }

export function createYouTubePublication(input: { userId: string; clipId: string; title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; scheduledAt: string | null }) {
  const clip = db().prepare('SELECT c.video_path FROM clips c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.owner_id=?').get(input.clipId, input.userId) as { video_path?: string } | undefined;
  if (!clip?.video_path) throw new Error('Клип не найден.');
  const duplicate = db().prepare("SELECT id FROM publications WHERE clip_id=? AND platform='youtube' AND status IN ('queued','uploading','published') LIMIT 1").get(input.clipId) as { id?: string } | undefined;
  if (duplicate) throw new Error('Этот клип уже поставлен на публикацию в YouTube.');
  const id = randomUUID(); const now = new Date().toISOString();
  db().prepare("INSERT INTO publications (id,user_id,clip_id,platform,status,title,description,tags_json,privacy,scheduled_at,created_at,updated_at) VALUES (?,?,?,'youtube','queued',?,?,?,?,?,?,?)").run(id, input.userId, input.clipId, input.title, input.description, JSON.stringify(input.tags), input.privacy, input.scheduledAt, now, now);
  return { id, videoPath: String(clip.video_path) };
}
export function getPublication(id: string) { return db().prepare('SELECT * FROM publications WHERE id=?').get(id) as Record<string, unknown> | undefined; }
export function listClipPublications(userId: string, clipId: string) { return db().prepare('SELECT id,platform,status,privacy,scheduled_at,remote_id,error,created_at,updated_at FROM publications WHERE user_id=? AND clip_id=? ORDER BY created_at DESC').all(userId, clipId); }
export function listProjectPublications(userId: string, projectId: string) {
  return db().prepare(`SELECT pub.id,pub.clip_id,pub.platform,pub.status,pub.privacy,pub.scheduled_at,pub.remote_id,pub.error,pub.created_at,pub.updated_at
    FROM publications pub
    JOIN clips c ON c.id=pub.clip_id
    JOIN projects p ON p.id=c.project_id
    WHERE pub.user_id=? AND p.id=? AND p.owner_id=?
    ORDER BY pub.created_at DESC`).all(userId, projectId, userId);
}
export function listUserPublications(userId: string) {
  return db().prepare(`SELECT pub.id,pub.clip_id,pub.platform,pub.status,pub.title,pub.description,pub.privacy,pub.scheduled_at,pub.remote_id,pub.error,pub.created_at,pub.updated_at,
      c.project_id,c.title AS clip_title,c.start,c.end,p.title AS project_title
    FROM publications pub
    JOIN clips c ON c.id=pub.clip_id
    JOIN projects p ON p.id=c.project_id
    WHERE pub.user_id=? AND p.owner_id=?
    ORDER BY pub.created_at DESC`).all(userId, userId);
}
export function deleteFailedPublication(userId: string, publicationId: string) {
  const row = db().prepare("SELECT status FROM publications WHERE id=? AND user_id=?").get(publicationId, userId) as { status?: string } | undefined;
  if (!row) throw new Error('Публикация не найдена.');
  if (row.status !== 'failed') throw new Error('Удалить можно только неудачную загрузку.');
  db().prepare('DELETE FROM publications WHERE id=? AND user_id=?').run(publicationId, userId);
}
export function updatePublication(id: string, changes: { status?: string; remoteId?: string | null; error?: string | null; workerPid?: number | null }) {
  const columns = { status: 'status', remoteId: 'remote_id', error: 'error', workerPid: 'worker_pid' } as const;
  const entries = Object.entries(changes).filter(([key]) => key in columns);
  if (!entries.length) return;
  db().prepare(`UPDATE publications SET ${entries.map(([key]) => `${columns[key as keyof typeof columns]}=?`).join(',')}, updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
}

export function recoverStalledPublications(userId: string) {
  const rows = db().prepare("SELECT id,status,worker_pid,updated_at FROM publications WHERE user_id=? AND status IN ('queued','uploading')").all(userId) as Array<{ id: string; status: string; worker_pid: number | null; updated_at: string }>;
  const now = Date.now();
  for (const row of rows) {
    const age = now - new Date(row.updated_at).getTime();
    let alive = false;
    if (row.worker_pid && row.worker_pid > 0) {
      try { process.kill(row.worker_pid, 0); alive = true; } catch { alive = false; }
    }
    if ((!row.worker_pid && age > 10_000) || (row.worker_pid && !alive && age > 3_000)) {
      updatePublication(row.id, { status: 'failed', workerPid: null, error: row.status === 'queued' ? 'Воркер загрузки не запустился. Повторите публикацию.' : 'Загрузка была прервана. Повторите публикацию.' });
    }
  }
}
