import 'server-only';
import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { listOwnedStorageRecords } from '@/server/projects';

const terminal = new Set(['completed', 'failed', 'cancelled']);
const storageRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? 'storage');
const projectsRoot = path.join(storageRoot, 'projects');
const lastAutomaticCleanup = new Map<string, number>();

export interface StorageUsage { readyBytes: number; cacheBytes: number; totalBytes: number; projects: number; cacheFiles: number }

function projectDirectory(id: string) {
  const directory = path.resolve(projectsRoot, id);
  if (!/^[0-9a-f-]{36}$/u.test(id) || !directory.startsWith(projectsRoot + path.sep)) throw new Error('Некорректный каталог проекта.');
  return directory;
}

async function filesInside(directory: string): Promise<Array<{ path: string; size: number }>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: Array<{ path: string; size: number }> = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesInside(target));
    else if (entry.isFile()) files.push({ path: path.resolve(target), size: (await stat(target)).size });
  }
  return files;
}

export async function getStorageUsage(ownerId: string): Promise<StorageUsage> {
  const records = listOwnedStorageRecords(ownerId);
  let readyBytes = 0; let cacheBytes = 0; let cacheFiles = 0;
  for (const record of records) {
    const protectedFiles = new Set(record.protectedFiles.map(file => path.resolve(file)));
    for (const file of await filesInside(projectDirectory(record.id))) {
      if (protectedFiles.has(file.path)) readyBytes += file.size;
      else { cacheBytes += file.size; cacheFiles++; }
    }
  }
  return { readyBytes, cacheBytes, totalBytes: readyBytes + cacheBytes, projects: records.length, cacheFiles };
}

async function removeEmptyDirectories(directory: string, keepRoot = true) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) if (entry.isDirectory()) await removeEmptyDirectories(path.join(directory, entry.name), false);
  if (!keepRoot && !(await readdir(directory).catch(() => ['occupied'])).length) await rmdir(directory).catch(() => undefined);
}

export async function cleanupCache(ownerId: string, options: { olderThanDays?: number } = {}) {
  const records = listOwnedStorageRecords(ownerId);
  const cutoff = options.olderThanDays && options.olderThanDays > 0 ? Date.now() - options.olderThanDays * 86_400_000 : null;
  let deletedBytes = 0; let deletedFiles = 0;
  for (const record of records) {
    if (!terminal.has(record.status) || (cutoff !== null && Date.parse(record.updatedAt) > cutoff)) continue;
    const protectedFiles = new Set(record.protectedFiles.map(file => path.resolve(file)));
    const directory = projectDirectory(record.id);
    for (const file of await filesInside(directory)) {
      if (protectedFiles.has(file.path)) continue;
      await rm(file.path, { force: true });
      deletedBytes += file.size; deletedFiles++;
    }
    await removeEmptyDirectories(directory);
  }
  return { deletedBytes, deletedFiles };
}

export async function cleanupExpiredCache(ownerId: string, retentionDays: number) {
  return retentionDays > 0 ? cleanupCache(ownerId, { olderThanDays: retentionDays }) : { deletedBytes: 0, deletedFiles: 0 };
}

export async function maybeCleanupExpiredCache(ownerId: string, retentionDays: number) {
  const last = lastAutomaticCleanup.get(ownerId) ?? 0;
  if (Date.now() - last < 60 * 60_000) return { deletedBytes: 0, deletedFiles: 0 };
  lastAutomaticCleanup.set(ownerId, Date.now());
  return cleanupExpiredCache(ownerId, retentionDays);
}
