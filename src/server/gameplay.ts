import { readdir } from 'node:fs/promises';
import path from 'node:path';

const gameplayDirectory = path.resolve('public/gameplay');
const supportedExtensions = new Set(['.mp4', '.webm']);

export interface GameplayVideo {
  id: string;
  label: string;
  url: string;
  category: 'minecraft' | 'subway' | 'cs' | 'temple-run' | 'other';
  categoryLabel: string;
}

const categoryLabels = { minecraft: 'Minecraft', subway: 'Subway Surfers', cs: 'CS Surf', 'temple-run': 'Temple Run', other: 'Другое' } as const;

function labelFromFilename(filename: string) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\p{L}/gu, letter => letter.toUpperCase());
}

export async function listGameplayVideos(): Promise<GameplayVideo[]> {
  const files: string[] = [];
  async function scan(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(absolute);
      else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(path.relative(gameplayDirectory, absolute).split(path.sep).join('/'));
    }
  }
  await scan(gameplayDirectory);
  return files.sort((a, b) => a.localeCompare(b, 'ru')).map(id => {
    const hint = id.toLocaleLowerCase('en-US');
    const category = hint.includes('minecraft') ? 'minecraft' : hint.includes('subway') ? 'subway' : /(?:^|[/_-])(?:cs|counter|surf)/u.test(hint) ? 'cs' : hint.includes('temple') ? 'temple-run' : 'other';
    return { id, label: labelFromFilename(id), url: `/gameplay/${id.split('/').map(encodeURIComponent).join('/')}`, category, categoryLabel: categoryLabels[category] };
  });
}

export async function resolveGameplayVideo(id: string) {
  const item = (await listGameplayVideos()).find(video => video.id === id);
  return item ? path.join(gameplayDirectory, ...item.id.split('/')) : null;
}
