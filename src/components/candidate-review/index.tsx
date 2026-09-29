'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';

type Candidate = { index: number; title: string; reason: string; score: number; start: number; end: number; visualReason?: string; visualScore?: number; hookScore?: number; completenessScore?: number; valueScore?: number };
type Choice = { index: number; start: number; end: number };

function overlaps(a: Choice, b: Choice) {
  return a.start < b.end && a.end > b.start;
}

function nonOverlappingChoices(candidates: Candidate[], limit: number) {
  const chosen: Choice[] = [];
  for (const candidate of candidates) {
    const choice = { index: candidate.index, start: candidate.start, end: candidate.end };
    if (!chosen.some(item => overlaps(item, choice))) chosen.push(choice);
    if (chosen.length === limit) break;
  }
  return chosen;
}

function time(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function CandidateReview({ projectId, onApproved }: { projectId: string; onApproved: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [limit, setLimit] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/candidates`, { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить моменты.');
      if (!live) return;
      const list = data.candidates as Candidate[];
      setCandidates(list);
      setLimit(data.limit);
      setChoices(nonOverlappingChoices(list, data.limit));
      setActive(list[0]?.index ?? null);
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить моменты.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId]);

  const current = candidates.find(candidate => candidate.index === active);
  const preview = (candidate: Candidate) => {
    setActive(candidate.index);
    if (!video.current) return;
    const choice = choices.find(item => item.index === candidate.index);
    video.current.currentTime = choice?.start ?? candidate.start;
    void video.current.play().catch(() => {});
  };
  const toggle = (candidate: Candidate) => {
    const next = { index: candidate.index, start: candidate.start, end: candidate.end };
    if (!choices.some(item => item.index === candidate.index) && choices.some(item => overlaps(item, next))) {
      setError('Этот момент пересекается с уже выбранным. Сначала уберите другой момент.');
      return;
    }
    setError('');
    setChoices(previous => previous.some(item => item.index === candidate.index)
      ? previous.filter(item => item.index !== candidate.index)
      : previous.length < limit ? [...previous, next] : previous);
  };
  const replace = (candidate: Candidate) => {
    const otherChoices = choices.filter(choice => choice.index !== candidate.index);
    const replacement = candidates.find(item => item.index !== candidate.index && !choices.some(choice => choice.index === item.index) && !otherChoices.some(choice => overlaps(choice, item)));
    if (!replacement) { setError('Других вариантов больше нет.'); return; }
    setChoices(previous => previous.map(item => item.index === candidate.index
      ? { index: replacement.index, start: replacement.start, end: replacement.end } : item));
    setActive(replacement.index);
    setError('');
  };
  const changeBound = (index: number, key: 'start' | 'end', value: number) => {
    setChoices(previous => previous.map(item => item.index === index ? { ...item, [key]: value } : item));
  };
  const approve = async () => {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choices }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось запустить рендер.');
      onApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось запустить рендер.'); }
    finally { setSaving(false); }
  };

  return <section className={styles.review} aria-label='Выбор моментов'>
    <div className={styles.heading}><div><span>ШАГ ПЕРЕД МОНТАЖОМ</span><h2>Выберите моменты</h2><p>Просмотрите исходное видео, поправьте границы и оставьте лучшие варианты. Рендер начнётся после подтверждения.</p></div><strong>{choices.length} / {limit}</strong></div>
    {!loading && !candidates.some(candidate => candidate.visualScore !== undefined) && <p className={styles.error}>Визуальная оценка недоступна: кандидаты отобраны по расшифровке.</p>}
    {loading ? <p>Загружаем найденные моменты…</p> : <div className={styles.layout}>
      <div className={styles.player}>
        <video ref={video} src={`/api/projects/${projectId}/source`} controls preload='metadata' onLoadedMetadata={() => { if (video.current && current) video.current.currentTime = choices.find(item => item.index === current.index)?.start ?? current.start; }} onTimeUpdate={() => { const selected = choices.find(item => item.index === active); if (video.current && current && video.current.currentTime >= (selected?.end ?? current.end)) video.current.pause(); }} />
        {current && <p>{current.title} · {time(choices.find(item => item.index === current.index)?.start ?? current.start)}–{time(choices.find(item => item.index === current.index)?.end ?? current.end)}</p>}
      </div>
      <div className={styles.list}>{candidates.map(candidate => {
        const choice = choices.find(item => item.index === candidate.index);
        return <article className={choice ? styles.selected : ''} key={candidate.index}>
          <div className={styles.cardTop}><button type='button' className={styles.title} onClick={() => preview(candidate)}>{candidate.title}</button><span>{candidate.score}/100</span></div>
          <p>{candidate.reason}</p>{candidate.visualReason && <p>В кадре: {candidate.visualReason}</p>}<small>{time(candidate.start)}–{time(candidate.end)} · {Math.round(candidate.end - candidate.start)} сек.</small>
          <div className={styles.actions}><button type='button' onClick={() => preview(candidate)}>▶ Смотреть</button><button type='button' onClick={() => toggle(candidate)}>{choice ? 'Убрать' : 'Выбрать'}</button>{choice && <button type='button' onClick={() => replace(candidate)}>Найти замену</button>}</div>
          {choice && <div className={styles.bounds}><label>Начало, сек. <input type='number' step='0.1' min='0' value={choice.start} onChange={event => changeBound(candidate.index, 'start', Number(event.target.value))} /></label><label>Конец, сек. <input type='number' step='0.1' min='0' value={choice.end} onChange={event => changeBound(candidate.index, 'end', Number(event.target.value))} /></label></div>}
        </article>;
      })}</div>
    </div>}
    {error && <p className={styles.error} role='alert'>{error}</p>}
    {!loading && <div className={styles.footer}><span>Можно выбрать до {limit} моментов.</span><button type='button' disabled={!choices.length || saving} onClick={approve}>{saving ? 'Запускаем…' : `Смонтировать ${choices.length} ${choices.length === 1 ? 'клип' : 'клипа'}`}</button></div>}
  </section>;
}
