import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { selectBestClips, validateSegments } from './selection';
import { writeJson } from './core';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { count: { type: 'string', default: '2' } },
  });
  if (positionals.length !== 1) throw new Error('Запуск: npm run media:reselect -- <каталог проекта> [--count 2]');
  const directory = path.resolve(positionals[0]);
  const projectsRoot = path.resolve('storage/projects');
  if (!directory.startsWith(`${projectsRoot}${path.sep}`)) throw new Error('Нужен каталог внутри storage/projects.');
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Количество клипов: 1–5.');
  const transcript = JSON.parse(await readFile(path.join(directory, 'transcript.json'), 'utf8'));
  const segments = validateSegments(transcript.segments);
  const clips = await selectBestClips(segments, path.join(directory, 'selection-evaluation'), count);
  await writeJson(path.join(directory, 'selection-evaluation.json'), { clips });
  console.log(JSON.stringify(clips, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
