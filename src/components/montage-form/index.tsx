'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './index.module.scss';

export function MontageForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [subtitles, setSubtitles] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError('');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'montage', url, count, subtitles, subtitleColor: '#ffffff', captionStyle: 'mrbeast', wordHighlight: true, highlightKeywords: false, addEmojis: false, autoCensor: false, autoReframe: true, aspectRatio: '9:16', clipLength: 'medium', fitBackground: 'blur', clipPrompt: prompt }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось создать проект.');
      router.push(`/projects/${data.project.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать проект.'); setPending(false); }
  };
  return <form className={styles.form} onSubmit={submit}>
    <label>Исходное видео YouTube<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
    <div className={styles.row}><label>Монтажных клипов<select value={count} onChange={event => setCount(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label><label className={styles.check}><input type="checkbox" checked={subtitles} onChange={event => setSubtitles(event.target.checked)} /> Субтитры</label></div>
    <label>Что искать? <small>необязательно</small><input maxLength={300} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Например: неожиданная реакция и смешной финал" /></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="submit" disabled={pending}>{pending ? 'Создаём проект…' : 'Найти историю и построить план'}</button>
  </form>;
}
