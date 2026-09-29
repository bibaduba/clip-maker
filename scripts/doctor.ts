import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const tools = [
  { name: 'yt-dlp', command: 'yt-dlp', args: ['--version'] },
  { name: 'FFmpeg', command: 'ffmpeg', args: ['-version'] },
  { name: 'FFprobe', command: 'ffprobe', args: ['-version'] },
  { name: 'whisper.cpp', command: process.env.WHISPER_CLI ?? 'whisper-cli', args: ['--help'] },
  { name: 'llama.cpp', command: process.env.LLAMA_CLI ?? 'llama-completion', args: ['--version'] },
];

function checkCommand(command: string, args: string[]) {
  return new Promise<boolean>(resolve => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}

async function exists(file: string) {
  return access(path.resolve(file)).then(() => true).catch(() => false);
}

async function main() {
  console.log(`Система: ${process.platform} ${process.arch}; Node.js ${process.version}`);
  let ready = Number(process.versions.node.split('.')[0]) >= 22;
  console.log(`${ready ? '✓' : '✗'} Node.js 22 или новее`);
  for (const tool of tools) {
    const ok = await checkCommand(tool.command, tool.args);
    ready &&= ok;
    console.log(`${ok ? '✓' : '✗'} ${tool.name}: ${tool.command}`);
  }
  const models = [
    ['Whisper', process.env.WHISPER_MODEL ?? 'storage/models/ggml-small.bin'],
    ['Qwen', process.env.CLIP_LLM_MODEL ?? 'storage/models/Qwen3-4B-Q4_K_M.gguf'],
  ] as const;
  for (const [name, file] of models) {
    const ok = await exists(file);
    ready &&= ok;
    console.log(`${ok ? '✓' : '✗'} Модель ${name}: ${path.resolve(file)}`);
  }
  if (process.platform !== 'darwin') console.log('ℹ AI-кадрирование Apple Vision недоступно; будет использован центральный кадр.');
  if (!ready) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
