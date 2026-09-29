'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';

type Piece = { sourceIndex: number; start: number; end: number; role: string; effect: 'none' | 'punch' | 'flash' | 'freeze' | 'arrow'; arrowX?: number; arrowY?: number; text: string };
type Plan = { title: string; reason: string; pieces: Piece[]; totalDuration: number; planningSource?: 'vision' | 'transcript'; visualNotes?: string };
type Choice = { index: number; pieces: Piece[] };
const roleName: Record<string, string> = { hook: 'Завязка', development: 'Развитие', reaction: 'Реакция', payoff: 'Финал' };
function stamp(value: number) { return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`; }

export function MontageReview({ projectId, onApproved, clipId }: { projectId: string; onApproved: () => void; clipId?: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const endpoint = clipId ? `/api/clips/${clipId}/montage` : `/api/projects/${projectId}/montage`;
  useEffect(() => {
    let live = true;
    fetch(endpoint, { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить монтажный план.');
      if (live) { setPlans(data.plans); setChoices(data.plans.map((plan: Plan, index: number) => ({ index, pieces: plan.pieces }))); }
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить план.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [endpoint]);
  const watch = (piece: Piece) => { if (!video.current) return; stopAt.current = piece.end; video.current.currentTime = piece.start; void video.current.play().catch(() => {}); };
  const togglePlan = (index: number) => setChoices(previous => previous.some(choice => choice.index === index) ? previous.filter(choice => choice.index !== index) : [...previous, { index, pieces: plans[index].pieces }].sort((a, b) => a.index - b.index));
  const removePiece = (index: number, pieceIndex: number) => setChoices(previous => previous.map(choice => choice.index === index && choice.pieces.length > 2 ? { ...choice, pieces: choice.pieces.filter((_, at) => at !== pieceIndex) } : choice));
  const editPiece = (index: number, sourceIndex: number, change: Partial<Piece>) => setChoices(previous => previous.map(choice => choice.index === index ? { ...choice, pieces: choice.pieces.map(piece => piece.sourceIndex === sourceIndex ? { ...piece, ...change } : piece) } : choice));
  const approve = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plans: choices }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось запустить монтаж.');
      onApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось запустить монтаж.'); }
    finally { setSaving(false); }
  };
  return <section className={styles.review} aria-label="Проверка монтажного плана">
    <div className={styles.head}><div><span>{clipId ? 'РЕДАКТОР МОНТАЖА' : 'ПЕРЕД РЕНДЕРОМ'}</span><h2>Монтажный план</h2><p>Проверьте фрагменты и границы склеек. Плеер показывает исходник; эффекты применятся при рендере. Максимум два акцента на клип. Стрелка задаётся по координатам итогового кадра.</p></div><strong>{choices.length} / {plans.length}</strong></div>
    {loading ? <p>Загружаем план…</p> : <div className={styles.layout}><video ref={video} controls preload="metadata" src={`/api/projects/${projectId}/source`} onTimeUpdate={() => { if (video.current && stopAt.current !== null && video.current.currentTime >= stopAt.current) { video.current.pause(); stopAt.current = null; } }}/><div className={styles.plans}>{plans.map((plan, index) => {
      const choice = choices.find(item => item.index === index);
      return <article key={index}><header><div><h3>{plan.title}</h3><p>{plan.reason}</p><p>{plan.planningSource === 'vision' ? `По речи и кадрам${plan.visualNotes ? ` · Финал: ${plan.visualNotes}` : ''}` : 'План по расшифровке'}</p></div><button type="button" onClick={() => togglePlan(index)}>{choice ? 'Выбран' : 'Выбрать'}</button></header>
        {(choice?.pieces ?? plan.pieces).map((piece, pieceIndex) => <div className={styles.piece} key={piece.sourceIndex}><span>{roleName[piece.role] ?? 'Фрагмент'} · {stamp(piece.start)}–{stamp(piece.end)}</span><p>{piece.text || 'Визуальный момент без речи'}</p><button type="button" onClick={() => watch(piece)}>▶ Смотреть</button>{choice && <button type="button" disabled={choice.pieces.length <= 2} onClick={() => removePiece(index, pieceIndex)}>Убрать</button>}{choice && <div className={styles.controls}><label>Начало, сек.<input type="number" min="0" step="0.1" value={piece.start} onChange={event => editPiece(index, piece.sourceIndex, { start: Number(event.target.value) })} /></label><label>Конец, сек.<input type="number" min="0" step="0.1" value={piece.end} onChange={event => editPiece(index, piece.sourceIndex, { end: Number(event.target.value) })} /></label><label>Акцент<select value={piece.effect} onChange={event => editPiece(index, piece.sourceIndex, { effect: event.target.value as Piece['effect'] })}><option value="none">Без эффекта</option><option value="punch">Приближение</option><option value="flash">Вспышка</option><option value="freeze">Стоп-кадр</option><option value="arrow">Стрелка</option></select></label>{piece.effect === 'arrow' && <><label>Стрелка X, %<input type="number" min="25" max="85" value={Math.round((piece.arrowX ?? 0.5) * 100)} onChange={event => editPiece(index, piece.sourceIndex, { arrowX: Number(event.target.value) / 100 })} /></label><label>Стрелка Y, %<input type="number" min="15" max="72" value={Math.round((piece.arrowY ?? 0.4) * 100)} onChange={event => editPiece(index, piece.sourceIndex, { arrowY: Number(event.target.value) / 100 })} /></label></>}</div>}</div>)}
      </article>;
    })}</div></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && <button className={styles.approve} type="button" disabled={!choices.length || saving} onClick={approve}>{saving ? 'Рендерим…' : clipId ? 'Сохранить и перерендерить' : 'Смонтировать выбранные'}</button>}
  </section>;
}
