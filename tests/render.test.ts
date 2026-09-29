import test from 'node:test';
import assert from 'node:assert/strict';
import { assColor, assTimestamp, buildAss, escapeAssText, renderClip, subtitleCues } from '../scripts/media/render';

test('subtitle text cannot inject ASS overrides, breaks or events', () => {
  const escaped = escapeAssText('{\\pos(0,0)}Привет\\N\r\nDialogue: evil\u0000');
  assert.equal(/[{}\\\r\n\u0000]/u.test(escaped), false);
  assert.ok(escaped.includes('Привет'));
  const ass = buildAss([{ id: 0, start: 10, end: 12, text: '{\\b1}Привет\nмир' }], 10, 30);
  assert.equal(ass.split('\n').filter(line => line.startsWith('Dialogue:')).length, 1);
});

test('ASS timestamp handles carries', () => {
  assert.equal(assTimestamp(59.999), '0:01:00.00');
  assert.equal(assTimestamp(3600.12), '1:00:00.12');
  assert.throws(() => assTimestamp(NaN));
});

test('hex subtitle color becomes ASS BGR and rejects unsafe values', () => {
  assert.equal(assColor('#ffe5a0'), '&H00A0E5FF');
  assert.throws(() => assColor('red'));
});

test('absolute segment timing becomes relative and clips crossing intervals', () => {
  const cues = subtitleCues([{ id: 0, start: 8, end: 12, text: 'Привет мир' }, { id: 1, start: 29, end: 33, text: 'До свидания' }], 10, 30);
  assert.deepEqual(cues, [{ start: 0, end: 2, text: 'Привет мир' }, { start: 19, end: 20, text: 'До свидания' }]);
});

test('long Russian phrases form short proportional cues within original span', () => {
  const cues = subtitleCues([{ id: 0, start: 20, end: 30, text: 'Это длинная русская фраза для проверки распределения субтитров по коротким читаемым частям.' }], 10, 40);
  assert.ok(cues.length > 1);
  assert.ok(cues.every(cue => cue.text.length <= 32 && cue.end > cue.start));
  assert.equal(cues[0].start, 10);
  assert.ok(Math.abs(cues.at(-1)!.end - 20) < 0.00001);
  for (let index = 1; index < cues.length; index++) assert.equal(cues[index].start, cues[index - 1].end);
});

test('aligned whole words use their real timing and are never split into tokenizer pieces', () => {
  const cues = subtitleCues([{
    id: 0,
    start: 1,
    end: 4,
    text: 'Он получил результат',
    words: [
      { text: 'Он', start: 1, end: 1.3 },
      { text: 'получил', start: 1.4, end: 2.4 },
      { text: 'результат', start: 2.6, end: 3.8 },
    ],
  }], 0, 5);
  assert.deepEqual(cues, [
    { start: 1, end: 2.4, text: 'Он получил' },
    { start: 2.6, end: 3.8, text: 'результат' },
  ]);
});

test('empty and outside segments produce no cues', () => {
  assert.deepEqual(subtitleCues([{ id: 0, start: 0, end: 5, text: 'Раньше' }, { id: 1, start: 10, end: 12, text: ' ' }], 10, 30), []);
});

test('render rejects invalid boundaries before reading or spawning', async () => {
  for (const [start, end] of [[0, 19], [0, 91], [-1, 25], [NaN, 30], [0, Infinity]]) {
    await assert.rejects(renderClip({ sourcePath: '/missing', outputDirectory: '/missing', start, end, segments: [], subtitles: false }), /20 до 90/);
  }
});
