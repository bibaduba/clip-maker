import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ProcessingMode } from '@/lib/project-types';
import { claimNextQueuedProject, getProject, recoverInterruptedProjects, updateProject } from '@/server/projects';

export function startProjectWorker(projectId: string, processingMode: ProcessingMode) {
  const script = path.resolve('scripts/media/process-project.ts');
  const shim = path.resolve('scripts/windows-node-shim.cjs');
  const threads = processingMode === 'fast' ? '6' : '3';
  const nodeArgs = [...(process.platform === 'win32' ? ['--require', shim] : []), '--import', 'tsx', script, projectId];
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const toolPaths = [
    path.resolve('.tools'),
    path.resolve('.tools/ffmpeg/ffmpeg-n8.1-latest-win64-gpl-8.1/bin'),
    process.env.WHISPER_CLI ? path.dirname(process.env.WHISPER_CLI) : null,
    process.env.LLAMA_CLI ? path.dirname(process.env.LLAMA_CLI) : null,
  ].filter((value): value is string => Boolean(value));
  const workerEnv = { ...process.env, [pathKey]: [...toolPaths, process.env[pathKey] ?? ''].join(path.delimiter), CLIP_PROCESSING_MODE: processingMode, CLIP_LLM_THREADS: threads };
  const child = spawn(process.execPath, nodeArgs, { cwd: process.cwd(), detached: process.platform !== 'win32', windowsHide: true, stdio: 'ignore', env: workerEnv });
  if (!child.pid) throw new Error('Worker не вернул идентификатор процесса.');
  child.once('exit', code => {
    if (code !== 0) {
      const project = getProject(projectId);
      if (project && !['completed', 'failed', 'cancelled', 'review'].includes(project.status)) updateProject(projectId, { status: 'failed', workerPid: null, error: `Фоновая обработка завершилась с кодом ${code ?? 'unknown'}. Запустите проект повторно.` });
    }
    startNextQueuedProject();
  });
  child.unref();
  return child.pid;
}

export function startNextQueuedProject() {
  recoverInterruptedProjects();
  const project = claimNextQueuedProject();
  if (!project) return null;
  try {
    const pid = startProjectWorker(project.id, project.processingMode);
    updateProject(project.id, { workerPid: pid, workerHeartbeatAt: new Date().toISOString() });
    return pid;
  } catch (error) {
    updateProject(project.id, { status: 'failed', workerPid: null, error: error instanceof Error ? error.message : 'Не удалось запустить обработку.' });
    queueMicrotask(startNextQueuedProject);
    return null;
  }
}

export function stopProjectWorker(pid: number, force = false) {
  if (process.platform === 'win32') {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
}
