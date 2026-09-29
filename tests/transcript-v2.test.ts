import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscriptArtifactV2, transcriptV2Segments } from '../scripts/media/transcript-v2';

function artifact() {
  return {
    schemaVersion: 2,
    language: 'ru',
    model: 'large-v3-turbo',
    aligner: 'ru',
    audioFingerprint: 'a'.repeat(64),
    createdAt: '2026-09-17T00:00:00Z',
    processingSeconds: 1,
    device: 'cuda',
    computeType: 'float16',
    segments: [{
      id: 's0', text: 'Он получил результат', start: 1, end: 4,
      words: [
        { id: 's0w0', text: 'Он', normalized: 'он', start: 1, end: 1.3, confidence: 0.9 },
        { id: 's0w1', text: 'получил', normalized: 'получил', start: 1.4, end: 2.4, confidence: 0.95 },
        { id: 's0w2', text: 'результат', normalized: 'результат', start: 2.6, end: 3.8, confidence: null },
      ],
    }],
  };
}

test('v2 transcript keeps complete aligned words', () => {
  const parsed = parseTranscriptArtifactV2(artifact());
  const segments = transcriptV2Segments(parsed);
  assert.deepEqual(segments[0].words?.map(word => word.text), ['Он', 'получил', 'результат']);
});

test('v2 transcript rejects control tokens and overlapping words', () => {
  const control = artifact();
  control.segments[0].words[1].text = '[_TT_250]';
  assert.throws(() => parseTranscriptArtifactV2(control));
  const overlap = artifact();
  overlap.segments[0].words[1].start = 1.2;
  assert.throws(() => parseTranscriptArtifactV2(overlap));
});
