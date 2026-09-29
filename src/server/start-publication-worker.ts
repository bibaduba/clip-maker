import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getPublication, updatePublication } from '@/server/social';

export function startYouTubePublicationWorker(publicationId: string) {
  const script = path.resolve('scripts/social/publish-youtube.ts');
  const shim = path.resolve('scripts/windows-node-shim.cjs');
  const nodeArgs = [...(process.platform === 'win32' ? ['--require', shim] : []), '--import', 'tsx', script, publicationId];
  const child = spawn(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child.pid) throw new Error('Воркер YouTube не вернул идентификатор процесса.');
  updatePublication(publicationId, { workerPid: child.pid, error: null });
  child.once('error', error => {
    updatePublication(publicationId, { status: 'failed', workerPid: null, error: `Не удалось запустить загрузку: ${error.message}`.slice(0, 500) });
  });
  child.once('exit', code => {
    if (code === 0) return;
    const publication = getPublication(publicationId);
    if (publication && ['queued', 'uploading'].includes(String(publication.status))) {
      updatePublication(publicationId, { status: 'failed', workerPid: null, error: `Фоновая загрузка завершилась с кодом ${code ?? 'unknown'}. Повторите публикацию.` });
    }
  });
  child.unref();
  return child.pid;
}
