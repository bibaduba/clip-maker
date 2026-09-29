import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYouTubeVideoId } from '../src/lib/youtube';
import { normalizeTranscript, run } from '../scripts/media/core';

test('YouTube URLs normalize to the same ID', () => {
  for (const url of ['https://www.youtube.com/watch?v=34HF78uOe1k&t=12', 'https://youtu.be/34HF78uOe1k', 'https://m.youtube.com/shorts/34HF78uOe1k', 'https://youtube.com/live/34HF78uOe1k']) assert.equal(getYouTubeVideoId(url), '34HF78uOe1k');
});
test('URLs cannot select arbitrary network endpoints', () => {
  for (const url of ['http://youtube.com/watch?v=34HF78uOe1k', 'https://youtube.com.evil.com/watch?v=34HF78uOe1k', 'https://127.0.0.1/watch?v=34HF78uOe1k', 'https://x:password@youtube.com/watch?v=34HF78uOe1k', 'https://youtube.com:3000/watch?v=34HF78uOe1k', 'https://youtube.com/playlist?list=123', 'https://youtu.be/../../etc/passwd']) assert.equal(getYouTubeVideoId(url), null);
});
test('Whisper milliseconds become seconds without losing Russian text', () => {
  assert.deepEqual(normalizeTranscript({ transcription: [{ offsets: { from: 100, to: 2500 }, text: ' Привет, мир! ' }] }, 3), [{ id: 0, start: 0.1, end: 2.5, text: 'Привет, мир!' }]);
});
test('Invalid, overlapping and out-of-range timestamps are rejected', () => {
  for (const offsets of [{ from: -1, to: 100 }, { from: 100, to: 50 }, { from: 0, to: 99999 }, { from: undefined, to: 100 }]) assert.throws(() => normalizeTranscript({ transcription: [{ offsets, text: 'Текст' }] }, 5));
  assert.throws(() => normalizeTranscript({ transcription: [{ offsets: { from: 0, to: 2000 }, text: 'Один' }, { offsets: { from: 1000, to: 3000 }, text: 'Два' }] }, 5));
  assert.throws(() => normalizeTranscript({ transcription: [] }, 5), /речи/);
});
test('Child process arguments stay literal and failures propagate', async () => {
  const text = '$(touch should-not-exist); `echo injected`';
  assert.equal((await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text])).trim(), text);
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(2)']), /код 2/);
  await assert.rejects(run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 30 }), /время/);
});
test('A segment beyond audio duration cannot become a reversed interval', () => {
  assert.throws(() => normalizeTranscript({ transcription: [{ offsets: { from: 10100, to: 10200 }, text: 'Конец' }] }, 10));
});
test('Cancellation and missing tools fail cleanly', async () => {
  await assert.rejects(run('clip-maker-nonexistent-binary', []), /ENOENT/);
  const controller = new AbortController();
  const task = run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(task, /отменена/);
});
test('Whisper tail overrun is clamped and marked incomplete', () => {
  const result = normalizeTranscript({ transcription: [{ offsets: { from: 178000, to: 182000 }, text: 'Оборванная фраза' }] }, 180);
  assert.deepEqual(result, [{ id: 0, start: 178, end: 180, text: 'Оборванная фраза', truncated: true }]);
});
