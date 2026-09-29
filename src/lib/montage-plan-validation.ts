import type { MontagePiece, MontagePlan } from '../../scripts/media/montage-plan';

const effects = new Set<MontagePiece['effect']>(['none', 'punch', 'flash', 'freeze', 'arrow']);

/** Only timings/effects of existing pieces may change; title, text and source are server-owned. */
export function validateMontagePlan(original: MontagePlan, raw: unknown, analyzedDuration: number): MontagePlan {
  if (!raw || typeof raw !== 'object') throw new Error('Некорректный монтажный план.');
  const input = raw as { pieces?: unknown };
  if (!Array.isArray(input.pieces) || input.pieces.length < 2 || input.pieces.length > original.pieces.length) throw new Error('В монтаже должно остаться от двух до шести фрагментов.');
  const pieces: MontagePiece[] = [];
  for (const value of input.pieces) {
    if (!value || typeof value !== 'object') throw new Error('Некорректный фрагмент.');
    const item = value as Record<string, unknown>;
    const sourceIndex = Number(item.sourceIndex);
    const source = original.pieces.find(piece => piece.sourceIndex === sourceIndex);
    const start = Number(item.start); const end = Number(item.end);
    if (!Number.isInteger(sourceIndex) || !source || !Number.isFinite(start) || !Number.isFinite(end) || Math.abs(start - source.start) > 10 || Math.abs(end - source.end) > 10 || start < 0 || end > analyzedDuration + 0.1 || end - start < 1.5) throw new Error('Границы фрагмента выходят за допустимый диапазон.');
    if (pieces.length && (sourceIndex <= pieces.at(-1)!.sourceIndex || start < pieces.at(-1)!.end + 0.05)) throw new Error('Фрагменты должны идти по порядку и не пересекаться.');
    const effect = item.effect as MontagePiece['effect'];
    if (!effects.has(effect)) throw new Error('Некорректный эффект.');
    const arrowX = Number(item.arrowX ?? source.arrowX ?? 0.5);
    const arrowY = Number(item.arrowY ?? source.arrowY ?? 0.4);
    if (effect === 'arrow' && (!Number.isFinite(arrowX) || !Number.isFinite(arrowY) || arrowX < 0.25 || arrowX > 0.85 || arrowY < 0.15 || arrowY > 0.72)) throw new Error('Укажите положение стрелки внутри кадра.');
    pieces.push({ sourceIndex, start, end, role: 'development', effect, ...(effect === 'arrow' ? { arrowX, arrowY } : {}), text: source.text });
  }
  pieces[0].role = 'hook'; pieces.at(-1)!.role = 'payoff';
  let accents = 0;
  for (const piece of pieces) if (piece.effect !== 'none') accents++;
  if (accents > 2) throw new Error('В одном клипе допускается не больше двух визуальных акцентов.');
  const totalDuration = pieces.reduce((sum, piece) => sum + piece.end - piece.start + (piece.effect === 'freeze' ? 0.3 : 0), 0);
  if (totalDuration < 12 || totalDuration > 90) throw new Error('Длина монтажа должна быть от 12 до 90 секунд.');
  return { ...original, pieces, totalDuration };
}
