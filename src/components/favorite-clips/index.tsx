"use client"
import { useEffect, useState } from "react"
import styles from "./index.module.scss"

type FavoriteClip = {
  id: string
  project_id: string
  title: string
  reason: string
  project_title: string | null
  start: number
  end: number
  size_bytes: number | null
  created_at: string
  aspect_ratio: string
  series_part: number | null
  series_total: number | null
}

function formatSize(bytes: number | null) {
  return bytes == null ? "размер неизвестен" : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export function FavoriteClips() {
  const [clips, setClips] = useState<FavoriteClip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/clips/favorites", { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setClips(data.clips ?? []) })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Не удалось загрузить избранное."))
      .finally(() => setLoading(false))
  }, [])

  const remove = async (clip: FavoriteClip) => {
    setRemoving(clip.id); setError("")
    try {
      const response = await fetch(`/api/clips/${clip.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorite: false }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setClips(items => items.filter(item => item.id !== clip.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось убрать клип из избранного.") }
    finally { setRemoving(null) }
  }

  return <section className={styles.page}>
    <header><div><span>ВАША КОЛЛЕКЦИЯ</span><h1>Избранные клипы</h1><p>Лучшие нарезки, которые вы решили сохранить отдельно.</p></div></header>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.empty}>Загружаем избранное…</div> : !clips.length ? <div className={styles.empty}><strong>В избранном пока пусто</strong><p>Нажмите на сердечко в карточке готового клипа — он появится здесь.</p><a href="/">Перейти к проектам</a></div> : <div className={styles.grid}>{clips.map(clip => <article key={clip.id}>
      <a className={styles.preview} href={`/projects/${clip.project_id}`}><img src={`/api/clips/${clip.id}/preview`} alt=""/><small>{Math.round(clip.end - clip.start)} сек.</small></a>
      <div className={styles.body}>
        <div className={styles.meta}><span>{clip.aspect_ratio}</span><time dateTime={clip.created_at}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(clip.created_at))}</time></div>
        {clip.series_part != null && clip.series_total != null && <div className={styles.series}>История · часть {clip.series_part} из {clip.series_total}</div>}
        <h2>{clip.title}</h2>
        <p>{clip.reason}</p>
        <a className={styles.project} href={`/projects/${clip.project_id}`}>{clip.project_title || "Открыть проект"}</a>
        <div className={styles.footer}><span>{formatSize(clip.size_bytes)}</span><div><a href={`/api/clips/${clip.id}/video`} download={`clip-${clip.id}.mp4`} title="Скачать" aria-label={`Скачать ${clip.title}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg></a><button type="button" disabled={removing === clip.id} onClick={() => remove(clip)} title="Убрать из избранного" aria-label={`Убрать из избранного: ${clip.title}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.4 13A5.1 5.1 0 0 1 11.6 5.8L12 6.2l.4-.4A5.1 5.1 0 0 1 19.6 13L12 20.2Z"/></svg></button></div></div>
      </div>
    </article>)}</div>}
  </section>
}
