"use client"
import { useEffect, useState } from "react"
import styles from "./index.module.scss"

type Clip = { id: string; title: string }
const DEFAULT_HASHTAGS = "#shorts #валакас #гладвалакас #нарезка #шуточное #юмор"
export type Publication = { id: string; clip_id?: string; status: string; remote_id?: string | null; error?: string | null; privacy?: string; scheduled_at?: string | null; updated_at?: string }
export function PublishDialog({ clip, projectId, onClose, onPublicationChange }: { clip: Clip | null; projectId: string; onClose: () => void; onPublicationChange?: (publication: Publication) => void }) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [hashtags, setHashtags] = useState(DEFAULT_HASHTAGS)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [privacy, setPrivacy] = useState("private")
  const [scheduledAt, setScheduledAt] = useState("")
  const [publication, setPublication] = useState<Publication | null>(null)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (!clip) return
    setTitle(clip.title.slice(0, 100)); setDescription(""); setHashtags(DEFAULT_HASHTAGS); setPublication(null); setError(""); setConnected(null)
    fetch(`/api/social/youtube?clipId=${clip.id}`, { cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); const current = data.publications?.[0] ?? null; setConnected(data.connected); setPublication(current); if (current) onPublicationChange?.({ ...current, clip_id: clip.id }) }).catch(cause => setError(cause instanceof Error ? cause.message : "Не удалось проверить YouTube."))
  }, [clip])
  useEffect(() => {
    if (!clip || !publication || !["queued", "uploading"].includes(publication.status)) return
    const timer = setTimeout(() => fetch(`/api/social/youtube?clipId=${clip.id}`, { cache: "no-store" }).then(response => response.json()).then(data => { const current = data.publications?.[0] ?? publication; setPublication(current); onPublicationChange?.({ ...current, clip_id: clip.id }) }).catch(() => null), 2000)
    return () => clearTimeout(timer)
  }, [clip, publication])
  if (!clip) return null
  const submit = async () => {
    setSubmitting(true); setError("")
    try {
      const response = await fetch('/api/social/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clipId: clip.id, title, description, hashtags, privacy, scheduledAt: scheduledAt || null }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      const current = { id: data.publicationId, clip_id: clip.id, status: data.status }; setPublication(current); onPublicationChange?.(current)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать публикацию.") }
    finally { setSubmitting(false) }
  }
  const generateDescription = async () => {
    setGeneratingDescription(true); setError("")
    try {
      const response = await fetch('/api/social/youtube/description', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clipId: clip.id }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setDescription(data.description)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать описание.") }
    finally { setGeneratingDescription(false) }
  }
  const busy = submitting || publication?.status === 'queued' || publication?.status === 'uploading'
  return <div className={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="publish-title">
    <header><div><span>АВТОПУБЛИКАЦИЯ</span><h2 id="publish-title">YouTube Shorts</h2></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></header>
    {connected === false ? <div className={styles.connect}><p>Подключите канал и разрешите загрузку видео. Пароль Google приложению не передаётся.</p><a href={`/api/social/youtube/connect?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`}>Подключить YouTube</a></div> : connected === null ? <p>Проверяем подключение…</p> : <>
      <label>Заголовок<input value={title} maxLength={100} disabled={busy} onChange={event => setTitle(event.target.value)}/></label>
      <label><span className={styles.labelHeader}>Описание<button type="button" disabled={busy || generatingDescription} onClick={generateDescription}>{generatingDescription ? 'Пишем…' : '✨ AI'}</button></span><textarea value={description} maxLength={5000} rows={4} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="Коротко о том, что происходит в клипе"/></label>
      <label>Хештеги<input value={hashtags} maxLength={500} disabled={busy} onChange={event => setHashtags(event.target.value)} placeholder="#shorts #юмор #нарезка"/><small>Вводите через пробел. Каждый #хештег будет передан как отдельный тег YouTube.</small></label>
      <small>Дополнительные сведения заполнятся автоматически: категория «Юмор», язык видео и названия — русский.</small>
      <div className={styles.row}><label>Доступ<select value={privacy} disabled={busy || Boolean(scheduledAt)} onChange={event => setPrivacy(event.target.value)}><option value="private">Приватное</option><option value="unlisted">По ссылке</option><option value="public">Публичное</option></select></label><label>Отложить<input type="datetime-local" value={scheduledAt} disabled={busy} onChange={event => { setScheduledAt(event.target.value); if (event.target.value) setPrivacy('private') }}/></label></div>
      <small>Для отложенной публикации YouTube сначала загружает ролик приватно. Непроверенный API-проект также может принудительно оставлять загрузки приватными.</small>
      {publication && <div className={`${styles.status} ${styles[publication.status] ?? ''}`}>{publication.status === 'queued' ? 'В очереди на загрузку' : publication.status === 'uploading' ? 'Загружаем в YouTube…' : publication.status === 'published' ? <>{publication.remote_id ? <a href={`https://youtu.be/${publication.remote_id}`} target="_blank" rel="noreferrer">Открыть опубликованный ролик</a> : 'Опубликовано'}</> : `Ошибка: ${publication.error ?? 'неизвестная ошибка'}`}</div>}
      {error && <p className={styles.error}>{error}</p>}
      <footer><button type="button" onClick={onClose}>Закрыть</button><button type="button" disabled={busy || !title.trim() || publication?.status === 'published'} onClick={submit}>{busy ? 'Публикуем…' : publication?.status === 'failed' ? 'Повторить' : 'Опубликовать'}</button></footer>
    </>}
  </section></div>
}
