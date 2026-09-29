import 'server-only';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AuthUser } from '@/lib/auth-types';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'clip_session';
const storageRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage');
let database: DatabaseSync | undefined;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

function db() {
  if (database) return database;
  mkdirSync(storageRoot, { recursive: true });
  const opened = new DatabaseSync(path.join(storageRoot, 'clip-maker.sqlite'));
  opened.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT, password_salt TEXT, google_sub TEXT UNIQUE,
  theme TEXT NOT NULL DEFAULT 'system', default_mode TEXT NOT NULL DEFAULT 'fast',
  default_subtitles INTEGER NOT NULL DEFAULT 1, default_reframe INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);`);
  const userColumns = opened.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userColumns.some(column => column.name === 'cache_retention_days')) opened.exec('ALTER TABLE users ADD COLUMN cache_retention_days INTEGER NOT NULL DEFAULT 30');
  database = opened;
  return opened;
}

type Row = Record<string, unknown>;
function userFromRow(row: Row): AuthUser {
  return { id: String(row.id), username: String(row.username), email: row.email ? String(row.email) : null, theme: row.theme === 'light' || row.theme === 'dark' ? row.theme : 'system', defaultMode: 'fast', defaultSubtitles: Boolean(row.default_subtitles), defaultReframe: Boolean(row.default_reframe), cacheRetentionDays: Number(row.cache_retention_days ?? 30), hasPassword: Boolean(row.password_hash) };
}
function validUsername(value: string) { return /^[a-zA-Zа-яА-ЯёЁ0-9_.-]{3,32}$/u.test(value); }
async function passwordHash(password: string, salt: string) { return Buffer.from(await scrypt(password, salt, 64) as ArrayBuffer).toString('hex'); }
function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
function claimLegacyProjects(userId: string) {
  const columns = db().prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
  if (!columns.length) return;
  if (!columns.some(column => column.name === 'owner_id')) db().exec('ALTER TABLE projects ADD COLUMN owner_id TEXT');
  db().prepare('UPDATE projects SET owner_id = ? WHERE owner_id IS NULL').run(userId);
}
function cookieOptions(expires?: Date) { return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', ...(expires ? { expires } : {}) }; }

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url'); const now = new Date(); const expires = new Date(now.getTime() + 30 * 86400_000);
  db().prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), userId, expires.toISOString(), now.toISOString());
  const store = await cookies(); store.set(SESSION_COOKIE, token, cookieOptions(expires));
  const row = db().prepare('SELECT theme FROM users WHERE id = ?').get(userId) as Row | undefined;
  if (row) store.set('clip_theme', String(row.theme), { sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
}
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db().prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(tokenHash(token), new Date().toISOString()) as Row | undefined;
  return row ? userFromRow(row) : null;
}
export async function logout() {
  const store = await cookies(); const token = store.get(SESSION_COOKIE)?.value;
  if (token) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  store.set(SESSION_COOKIE, '', cookieOptions(new Date(0))); store.set('clip_theme', '', { path: '/', expires: new Date(0) });
}
export async function register(username: string, password: string) {
  username = username.trim();
  if (!validUsername(username)) throw new Error('Логин: 3–32 буквы, цифры, точка, дефис или подчёркивание.');
  if (password.length < 8 || password.length > 128) throw new Error('Пароль должен содержать от 8 до 128 символов.');
  const id = randomUUID(); const salt = randomBytes(16).toString('hex'); const hash = await passwordHash(password, salt); const now = new Date().toISOString();
  try { db().prepare('INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, username, hash, salt, now, now); }
  catch { throw new Error('Этот логин уже занят.'); }
  claimLegacyProjects(id);
  await createSession(id); return userFromRow(db().prepare('SELECT * FROM users WHERE id = ?').get(id) as Row);
}
export async function login(username: string, password: string) {
  const key = username.trim().toLocaleLowerCase('ru-RU'); const attempt = loginAttempts.get(key);
  if (attempt && attempt.blockedUntil > Date.now()) throw new Error('Слишком много попыток. Повторите через несколько минут.');
  const row = db().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as Row | undefined;
  const salt = row?.password_salt ? String(row.password_salt) : '00000000000000000000000000000000';
  const actual = Buffer.from(await passwordHash(password, salt), 'hex');
  const expected = row?.password_hash ? Buffer.from(String(row.password_hash), 'hex') : Buffer.alloc(64);
  if (!row?.password_hash || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    const failures = (attempt?.failures ?? 0) + 1; loginAttempts.set(key, { failures, blockedUntil: failures >= 5 ? Date.now() + 10 * 60_000 : 0 });
    throw new Error('Неверный логин или пароль.');
  }
  loginAttempts.delete(key);
  await createSession(String(row.id)); return userFromRow(row);
}
export function findOrCreateGoogleUser(input: { sub: string; email: string; name?: string }) {
  let row = db().prepare('SELECT * FROM users WHERE google_sub = ? OR email = ?').get(input.sub, input.email) as Row | undefined;
  if (row) { db().prepare('UPDATE users SET google_sub = ?, email = ?, updated_at = ? WHERE id = ?').run(input.sub, input.email, new Date().toISOString(), String(row.id)); return String(row.id); }
  const base = (input.name || input.email.split('@')[0]).replace(/[^a-zA-Zа-яА-ЯёЁ0-9_.-]/gu, '').slice(0, 25) || 'user';
  let username = base; let suffix = 1;
  while (db().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `${base}${suffix++}`;
  const id = randomUUID(); const now = new Date().toISOString();
  db().prepare('INSERT INTO users (id, username, email, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, username, input.email, input.sub, now, now);
  claimLegacyProjects(id);
  return id;
}
export async function updateSettings(userId: string, input: { username?: string; theme?: string; defaultMode?: string; defaultSubtitles?: boolean; defaultReframe?: boolean; cacheRetentionDays?: number; currentPassword?: string; newPassword?: string }) {
  const row = db().prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row;
  const username = input.username?.trim() ?? String(row.username);
  if (!validUsername(username)) throw new Error('Некорректный логин.');
  if (input.newPassword) {
    if (input.newPassword.length < 8 || input.newPassword.length > 128) throw new Error('Новый пароль должен содержать от 8 до 128 символов.');
    if (row.password_hash) {
      const actual = Buffer.from(await passwordHash(input.currentPassword ?? '', String(row.password_salt)), 'hex'); const expected = Buffer.from(String(row.password_hash), 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Текущий пароль неверен.');
    }
    const salt = randomBytes(16).toString('hex'); const hash = await passwordHash(input.newPassword, salt);
    db().prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, userId);
  }
  const theme = String(['system', 'light', 'dark'].includes(input.theme ?? '') ? input.theme : row.theme);
  const mode = String(input.defaultMode === 'fast' ? 'fast' : input.defaultMode === 'eco' ? 'eco' : row.default_mode);
  const retention = [0, 1, 7, 30, 90].includes(Number(input.cacheRetentionDays)) ? Number(input.cacheRetentionDays) : Number(row.cache_retention_days ?? 30);
  try { db().prepare('UPDATE users SET username = ?, theme = ?, default_mode = ?, default_subtitles = ?, default_reframe = ?, cache_retention_days = ?, updated_at = ? WHERE id = ?').run(username, theme, mode, Number(input.defaultSubtitles ?? Boolean(row.default_subtitles)), Number(input.defaultReframe ?? Boolean(row.default_reframe)), retention, new Date().toISOString(), userId); }
  catch { throw new Error('Этот логин уже занят.'); }
  (await cookies()).set('clip_theme', String(theme), { sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
  return userFromRow(db().prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row);
}
