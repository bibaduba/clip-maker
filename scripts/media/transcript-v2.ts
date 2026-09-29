export interface AlignedWord {
  id: string;
  text: string;
  normalized: string;
  start: number;
  end: number;
  confidence: number | null;
  speaker?: string;
}

export interface AlignedSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: AlignedWord[];
  speaker?: string;
}

export interface TranscriptArtifactV2 {
  schemaVersion: 2;
  language: string;
  model: string;
  aligner: string | null;
  audioFingerprint: string;
  createdAt: string;
  processingSeconds: number;
  device: 'cuda' | 'cpu';
  computeType: string;
  diarizationEnabled?: boolean;
  segments: AlignedSegment[];
}

import type { Segment } from './core';

const controlToken = /\[\s*_?TT_?\d+\s*\]|<\|[^|>]+\|>/iu;
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

export function parseTranscriptArtifactV2(value: unknown): TranscriptArtifactV2 {
  if (!object(value) || value.schemaVersion !== 2 || typeof value.language !== 'string' || !value.language || typeof value.model !== 'string' || !value.model || (value.aligner !== null && typeof value.aligner !== 'string') || typeof value.audioFingerprint !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.audioFingerprint) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !finite(value.processingSeconds) || value.processingSeconds < 0 || !['cuda', 'cpu'].includes(String(value.device)) || typeof value.computeType !== 'string' || !Array.isArray(value.segments)) throw new Error('Некорректный формат расшифровки v2.');
  let previousSegmentEnd = 0;
  const segments = value.segments.map((segmentValue, segmentIndex): AlignedSegment => {
    if (!object(segmentValue) || typeof segmentValue.id !== 'string' || typeof segmentValue.text !== 'string' || !segmentValue.text.trim() || controlToken.test(segmentValue.text) || !finite(segmentValue.start) || !finite(segmentValue.end) || segmentValue.start < previousSegmentEnd || segmentValue.end <= segmentValue.start || !Array.isArray(segmentValue.words)) throw new Error(`Некорректный сегмент расшифровки v2: ${segmentIndex}.`);
    const segmentStart = segmentValue.start;
    const segmentEnd = segmentValue.end;
    let previousWordEnd = segmentStart;
    const words = segmentValue.words.map((wordValue, wordIndex): AlignedWord => {
      if (!object(wordValue) || typeof wordValue.id !== 'string' || typeof wordValue.text !== 'string' || !wordValue.text.trim() || controlToken.test(wordValue.text) || typeof wordValue.normalized !== 'string' || !finite(wordValue.start) || !finite(wordValue.end) || wordValue.start < previousWordEnd || wordValue.end <= wordValue.start || wordValue.end > segmentEnd + 0.01 || (wordValue.confidence !== null && (!finite(wordValue.confidence) || wordValue.confidence < 0 || wordValue.confidence > 1)) || (wordValue.speaker !== undefined && typeof wordValue.speaker !== 'string')) throw new Error(`Некорректное слово расшифровки v2: ${segmentIndex}.${wordIndex}.`);
      previousWordEnd = wordValue.end;
      return wordValue as unknown as AlignedWord;
    });
    previousSegmentEnd = segmentEnd;
    if (segmentValue.speaker !== undefined && typeof segmentValue.speaker !== 'string') throw new Error(`Некорректный спикер сегмента: ${segmentIndex}.`);
    return { id: segmentValue.id, text: segmentValue.text, start: segmentStart, end: segmentEnd, words, ...(segmentValue.speaker ? { speaker: segmentValue.speaker } : {}) };
  });
  if (!segments.length) throw new Error('Расшифровка v2 не содержит речи.');
  return { ...value, schemaVersion: 2, device: value.device as 'cuda' | 'cpu', segments } as TranscriptArtifactV2;
}

export function transcriptV2Segments(artifact: TranscriptArtifactV2): Segment[] {
  return artifact.segments.map((segment, index) => ({
    id: index,
    text: segment.text,
    start: segment.start,
    end: segment.end,
    ...(segment.speaker ? { speaker: segment.speaker } : {}),
    ...(segment.words.length ? { words: segment.words.map(word => ({ start: word.start, end: word.end, text: word.text, ...(word.confidence === null ? {} : { probability: word.confidence }), ...(word.speaker ? { speaker: word.speaker } : {}) })) } : {}),
  }));
}
