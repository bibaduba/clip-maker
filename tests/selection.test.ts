import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSegments, validateSelection, parseModelJson, isLikelyPromotion, isTitleGrounded, chooseBestCandidates, buildAnalysisBlocks, groundedEvidence, groundedTitle } from '../scripts/media/selection';
const segments = [{ id: 0, start: 0, end: 15, text: 'Начало.' }, { id: 1, start: 15, end: 35, text: 'Вывод.' }, { id: 2, start: 35, end: 60, text: 'Оборванная мысль', truncated: true }];
const clip = { title: 'Начало и вывод', reason: 'Вывод.', score: 82, startSegmentId: 0, endSegmentId: 1 };
test('Model selects IDs; server derives timestamps', () => { assert.deepEqual(validateSelection({ clips: [{ ...clip, start: 999 }] }, segments, 2)[0], { ...clip, start: 0, end: 35 }); });
test('Invalid, overlapping, incomplete and too short candidates fail', () => {
  for (const clips of [[{ ...clip, endSegmentId: 999 }], [{ ...clip, endSegmentId: 2 }], [{ ...clip, endSegmentId: 0 }], [clip, clip]]) assert.throws(() => validateSelection({ clips }, segments, 2));
  assert.throws(() => validateSelection({ clips: [clip] }, segments.map(s => ({ ...s, text: 'Продолжение,' })), 2));
  assert.deepEqual(validateSelection({ clips: [] }, segments, 2), []);
});
test('Transcript validation rejects duplicates and invalid intervals', () => {
  assert.throws(() => validateSegments([segments[0], segments[0]]));
  assert.throws(() => validateSegments([{ ...segments[0], start: -1 }]));
});
test('CLI JSON parser rejects malformed output', () => {
  assert.deepEqual(parseModelJson('banner\n{"clips":[]}\ntiming'), { clips: [] });
  assert.throws(() => parseModelJson('no results'));
  assert.throws(() => parseModelJson('{bad}'));
});
test('Promotion detector rejects calls to action and commercial offers', () => {
  assert.equal(isLikelyPromotion('Оформляйте карту по ссылке в описании и забирайте тысячу бонусных рублей.'), true);
  assert.equal(isLikelyPromotion('Новым пользователям дают бонусные рубли за оформление карты.'), true);
  assert.equal(isLikelyPromotion('В тесте батареи результат оказался на 18 процентов хуже.'), false);
});
test('Title must use content words found in the selected transcript', () => {
  assert.equal(isTitleGrounded('Результат теста батареи', 'Результат теста батареи оказался хуже.'), true);
  assert.equal(isTitleGrounded('Умные обновления для фото и видео', 'Нейронка достраивает фотографии и меняет перспективу.'), false);
});
test('Ungrounded model copy falls back to transcript words and an exact quote', () => {
  const source = 'Результат теста батареи оказался на восемнадцать процентов хуже. Автономность заметно упала.';
  const evidence = groundedEvidence('Телефон потерял два часа работы.', source, 'Плохая автономность телефона');
  const title = groundedTitle('Плохая автономность телефона', source, evidence);
  assert.equal(source.includes(evidence), true);
  assert.equal(isTitleGrounded(title, source), true);
});
test('Global ranking prefers score, removes nearby duplicates and skips the intro', () => {
  const candidate = { ...clip, start: 100, end: 125 };
  assert.deepEqual(chooseBestCandidates([
    { ...candidate, title: 'Слабый вариант', score: 72 },
    { ...candidate, title: 'Сильный вариант', start: 110, end: 135, score: 94 },
    { ...candidate, title: 'Другой эпизод', start: 300, end: 325, score: 88 },
    { ...candidate, title: 'Вступление ролика', start: 0, end: 25, score: 100 },
  ], 2).map(item => item.title), ['Сильный вариант', 'Другой эпизод']);
});
test('Long dense transcripts split by duration and serialized size with overlap', () => {
  const dense = Array.from({ length: 80 }, (_, id) => ({ id, start: id * 5, end: id * 5 + 5, text: `${'Очень плотная русская речь '.repeat(35)}.` }));
  const blocks = buildAnalysisBlocks(dense, { maxSeconds: 210, maxJsonChars: 6_000, overlapSeconds: 30 });
  assert.ok(blocks.length > 1);
  for (const block of blocks) {
    assert.ok(JSON.stringify(block).length <= 6_000);
    assert.ok(block.at(-1)!.end - block[0].start <= 210);
  }
  assert.ok(blocks.slice(1).every((block, index) => block[0].start < blocks[index].at(-1)!.end));
});
test('All offered AI windows obey duration and exclude truncated tails', async () => {
  const { buildCandidateWindows } = await import('../scripts/media/selection');
  const windows = buildCandidateWindows(segments);
  assert.ok(windows.length > 0);
  for (const window of windows) {
    assert.ok(window.duration >= 20 && window.duration <= 90);
    assert.notEqual(window.endSegmentId, 2);
    const range = segments.filter(segment => segment.id >= window.startSegmentId && segment.id <= window.endSegmentId);
    const groundedWord = range[0].text.match(/[a-zа-яё0-9]+/iu)![0];
    assert.equal(validateSelection({ clips: [{ ...clip, ...window, title: `${groundedWord} ${groundedWord}`, reason: range.at(-1)!.text }] }, segments, 1).length, 1);
  }
});
