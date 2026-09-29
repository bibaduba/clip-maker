"use client"
import { useEffect, useState } from "react"
import styles from "./index.module.scss"

type UploadedClip = {
  id: string
  clip_id: string
  project_id: string
  status: "queued" | "uploading" | "published" | "failed"
  title: string
  clip_title: string
  project_title: string | null
  privacy: "private" | "unlisted" | "public"
  scheduled_at: string | null
  remote_id: string | null
  error: string | null
  start: number
  end: number
  created_at: string
  updated_at: string
}

const statusLabels = { queued: "В очереди", uploading: "Загружается", published: "Опубликован", failed: "Ошибка" }
const privacyLabels = { private: "Приватное", unlisted: "По ссылке", public: "Публичное" }

export function UploadedClips() {
  const [clips, setClips] = useState<UploadedClip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const response = await fetch("/api/social/youtube?all=1", { cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить публикации.")
        if (!active) return
        const next = (data.publications ?? []) as UploadedClip[]
        setClips(next); setError(""); setLoading(false)
        if (next.some(item => ["queued", "uploading"].includes(item.status))) timer = setTimeout(load, 2000)
      } catch (cause) {
        if (!active) return
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить публикации."); setLoading(false)
        timer = setTimeout(load, 5000)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [])

  const removePublication = async (publication: UploadedClip) => {
    setDeleting(publication.id); setError("")
    try {
      const response = await fetch(`/api/social/youtube?publicationId=${publication.id}`, { method: "DELETE" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Не удалось удалить запись.")
      setClips(items => items.filter(item => item.id !== publication.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить запись.") }
    finally { setDeleting(null) }
  }

  return <section className={styles.page}>
    <header><div><span>АВТОПУБЛИКАЦИЯ</span><h1>Загруженные клипы</h1><p>Все ролики, отправленные в YouTube Shorts, и текущие загрузки.</p></div></header>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.empty}>Загружаем список…</div> : !clips.length ? <div className={styles.empty}><strong>Пока нет загруженных клипов</strong><p>Опубликуйте клип со страницы проекта, и он появится здесь.</p><a href="/">Перейти к проектам</a></div> : <div className={styles.grid}>{clips.map(clip => <article key={clip.id}>
      <a className={styles.preview} href={`/projects/${clip.project_id}`}><img src={`/api/clips/${clip.clip_id}/preview`} alt=""/><span className={`${styles.status} ${styles[clip.status]}`}>{statusLabels[clip.status]}</span><small>{Math.round(clip.end - clip.start)} сек.</small></a>
      <div className={styles.body}><div className={styles.meta}><span>YouTube Shorts</span><time dateTime={clip.created_at}>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(clip.created_at))}</time></div>
        <h2>{clip.title || clip.clip_title}</h2><a className={styles.project} href={`/projects/${clip.project_id}`}>{clip.project_title || "Открыть проект"}</a>
        <div className={styles.details}><span>{privacyLabels[clip.privacy]}</span>{clip.scheduled_at && <span>По расписанию: {new Date(clip.scheduled_at).toLocaleString("ru-RU")}</span>}</div>
        {clip.error && <p className={styles.failure}>{clip.error}</p>}
        <div className={styles.actions}>{clip.remote_id ? <a className={styles.youtube} href={`https://youtu.be/${clip.remote_id}`} target="_blank" rel="noreferrer">Открыть в YouTube ↗</a> : <span>{clip.status === "uploading" ? "Ролик отправляется…" : clip.status === "queued" ? "Ожидает загрузки" : "Повторите со страницы проекта"}</span>}{clip.status === "failed" && <button className={styles.remove} type="button" disabled={deleting === clip.id} onClick={() => removePublication(clip)} aria-label={`Удалить неудачную загрузку ${clip.title}`} title="Удалить из загруженных">✕</button>}</div>
      </div>
    </article>)}</div>}
  </section>
}
