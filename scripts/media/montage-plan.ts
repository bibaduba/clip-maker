import type { Segment } from './core';
import type { ClipCandidate } from './selection';

export interface MontagePiece {
  sourceIndex: number;
  start: number;
  end: number;
  role: 'hook' | 'development' | 'reaction' | 'payoff';
  effect: 'none' | 'punch' | 'flash' | 'freeze' | 'arrow';
  arrowX?: number;
  arrowY?: number;
  text: string;
}

export interface MontagePlan {
  title: string;
  reason: string;
  sourceCandidate: ClipCandidate;
  pieces: MontagePiece[];
  totalDuration: number;
  planningSource?: 'vision' | 'transcript';
  visualNotes?: string;
}

/** A conservative first-pass EDL: keep one story, cut only at transcript boundaries. */
export function buildMontagePlan(candidate: ClipCandidate, transcript: Segment[]): MontagePlan | null {
  const lines = transcript.filter(line => line.end > candidate.start && line.start < candidate.end && !line.truncated);
  if (lines.length < 2) return null;
  const groups: Segment[][] = [];
  let current: Segment[] = [];
  for (const line of lines) {
    const previous = current.at(-1);
    if (previous && line.start - previous.end >= 0.65) { groups.push(current); current = []; }
    current.push(line);
  }
  if (current.length) groups.push(current);
  // If speech has no useful pause, divide at sentence boundaries instead.
  if (groups.length < 2) {
    groups.length = 0;
    const target = Math.min(3, lines.length);
    for (let index = 0; index < target; index++) {
      const from = Math.floor(index * lines.length / target);
      const to = Math.floor((index + 1) * lines.length / target);
      groups.push(lines.slice(from, to));
    }
  }
  const substantial = groups.filter(group => group.length && group.at(-1)!.end - group[0].start >= 1.5);
  if (substantial.length < 2) return null;
  const selected = substantial.length > 5 ? [...substantial.slice(0, 4), substantial.at(-1)!] : substantial;
  const roles: MontagePiece['role'][] = ['hook', 'development', 'reaction', 'reaction', 'payoff'];
  const pieces = selected.map((group, index): MontagePiece => ({
    sourceIndex: index,
    start: Math.max(candidate.start, group[0].start),
    end: Math.min(candidate.end, group.at(-1)!.end),
    role: index === selected.length - 1 ? 'payoff' : roles[index],
    effect: index === selected.length - 1 && (candidate.visualScore ?? 0) >= 65 ? 'punch' : 'none',
    text: group.map(line => line.text.trim()).join(' ').slice(0, 220),
  }));
  const totalDuration = pieces.reduce((sum, piece) => sum + piece.end - piece.start, 0);
  if (totalDuration < 12 || totalDuration > 90 || pieces.some(piece => piece.end <= piece.start)) return null;
  return { title: candidate.title, reason: candidate.reason, sourceCandidate: candidate, pieces, totalDuration, planningSource: 'transcript' };
}
