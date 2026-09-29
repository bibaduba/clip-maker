"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { ProjectRecord } from "@/lib/project-types"
import { stageLabels } from "@/lib/project-types"
import { isProjectActive, projectProgress } from "@/lib/project-progress"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PublishDialog, type Publication } from "@/components/publish-dialog"
import { ClipVisualEditor, type ManualCrop, type TextOverlay } from "@/components/clip-visual-editor"
import { CandidateReview } from "@/components/candidate-review"
import { MontageReview } from "@/components/montage-review"
import styles from "./index.module.scss"

const steps = [
  "metadata",
  "downloading",
  "transcribing",
  "selecting",
  "rendering",
] as const
type EditorSettings = {
  subtitles: boolean
  subtitleText: string
  transcript: Array<{ id: number; start: number; end: number; text: string }>
  cutSegments: number[]
  captionStyle: "default" | "modern" | "bouncy" | "mrbeast" | "business"
  subtitleColor: string
  wordHighlight: boolean
  highlightKeywords: boolean
  addEmojis: boolean
  autoCensor: boolean
  autoReframe: boolean
  reframeOffset: number
  manualCrop: ManualCrop | null
  textOverlays: TextOverlay[]
  duration: number
  start: number
  aspectRatio: string
  cropAspectRatio: string
  adhdMode: boolean
}
const editorStyles = [
  "default",
  "modern",
  "bouncy",
  "mrbeast",
  "business",
] as const
const editorColors = ["#ffd400", "#28c76f", "#43a5ff", "#ffffff"]
function formatSize(bytes: number | null) {
  return bytes == null ? null : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}
const formatDimensions = {
  "9:16": "720×1280",
  "1:1": "1080×1080",
  "4:5": "864×1080",
  "16:9": "1280×720",
} as const
const formatLabels = {
  "9:16": "Shorts",
  "1:1": "Квадрат",
  "4:5": "Портрет",
  "16:9": "Широкий",
} as const
const lengthLabels = {
  short: "20–30 сек.",
  medium: "30–60 сек.",
  long: "60–90 сек.",
} as const
const captionLabels = {
  default: "Default",
  modern: "Modern",
  bouncy: "Bouncy",
  mrbeast: "Mr. Beast",
  business: "Business",
} as const
function ActionIcon({ type }: { type: "download" | "publish" | "edit" | "delete" | "favorite" | "notInteresting" }) {
  if (type === "favorite")
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 20.2 4.4 13A5.1 5.1 0 0 1 11.6 5.8L12 6.2l.4-.4A5.1 5.1 0 0 1 19.6 13L12 20.2Z' />
      </svg>
    )
  if (type === "notInteresting")
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M8.2 3.8h8.1a2 2 0 0 1 1.9 1.4l1.5 5.2a2 2 0 0 1-1.9 2.6h-4.2l.6 3.5a2.7 2.7 0 0 1-.7 2.3L12.3 20 8 13H4V5.5h4.2V3.8ZM4 5.5H2v7.5h2' />
      </svg>
    )
  if (type === "download")
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 3v12m0 0 4-4m-4 4-4-4M5 20h14' />
      </svg>
    )
  if (type === "edit")
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20ZM14.8 6.4l2.8 2.8' />
      </svg>
    )
  if (type === "publish")
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 16V4m0 0-4 4m4-4 4 4M5 13v7h14v-7' />
      </svg>
    )
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5' />
    </svg>
  )
}
export function ProjectDetail({ id }: { id: string }) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectRecord | null>(null)
  const [loadError, setLoadError] = useState("")
  const [retrying, setRetrying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [pollVersion, setPollVersion] = useState(0)
  const [confirmRegeneration, setConfirmRegeneration] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "project" | "clip"
    id: string
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editClip, setEditClip] = useState<{
    id: string
    title: string
  } | null>(null)
  const [montageEditClip, setMontageEditClip] = useState<{ id: string; title: string } | null>(null)
  const [editor, setEditor] = useState<EditorSettings | null>(null)
  const [editorError, setEditorError] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [mediaVersion, setMediaVersion] = useState(0)
  const [publishClip, setPublishClip] = useState<{ id: string; title: string } | null>(null)
  const [publications, setPublications] = useState<Publication[]>([])
  const [publicationVersion, setPublicationVersion] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const response = await fetch(`/api/projects/${id}`, {
          cache: "no-store",
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Проект не найден.")
        if (!active) return
        setProject(data.project)
        setLoadError("")
        if (!["completed", "failed", "cancelled", "review"].includes(data.project.status))
          timer = setTimeout(load, 2000)
      } catch (error) {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить проект.",
          )
      }
    }
    load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [id, pollVersion])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const loadPublications = async () => {
      try {
        const response = await fetch(`/api/social/youtube?projectId=${id}`, { cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        if (!active) return
        const next = (data.publications ?? []) as Publication[]
        setPublications(next)
        if (next.some(item => ["queued", "uploading"].includes(item.status))) timer = setTimeout(loadPublications, 2000)
      } catch { if (active) timer = setTimeout(loadPublications, 5000) }
    }
    loadPublications()
    return () => { active = false; clearTimeout(timer) }
  }, [id, publicationVersion])
  if (loadError)
    return (
      <section className={styles.state}>
        <h1>Проект недоступен</h1>
        <p>{loadError}</p>
        <a href='/'>Вернуться к проектам</a>
      </section>
    )
  if (!project)
    return (
      <section className={styles.state}>
        <p>Загружаем проект…</p>
      </section>
    )
  const activeIndex = steps.indexOf(project.status as (typeof steps)[number])
  const isActive = isProjectActive(project.status)
  const progressValue = projectProgress[project.status]
  const setClipReaction = async (
    clipId: string,
    reaction: { favorite: boolean } | { notInteresting: boolean },
  ) => {
    const original = project.clips.find(clip => clip.id === clipId)
    if (!original) return
    const optimistic = "favorite" in reaction
      ? { favorite: reaction.favorite, notInteresting: reaction.favorite ? false : original.notInteresting }
      : { notInteresting: reaction.notInteresting, favorite: reaction.notInteresting ? false : original.favorite }
    setProject(current => current ? { ...current, clips: current.clips.map(clip => clip.id === clipId ? { ...clip, ...optimistic } : clip) } : current)
    try {
      const response = await fetch(`/api/clips/${clipId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reaction) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить реакцию.")
      setProject(current => current ? { ...current, clips: current.clips.map(clip => clip.id === clipId ? { ...clip, ...data } : clip) } : current)
    } catch {
      setProject(current => current ? { ...current, clips: current.clips.map(clip => clip.id === clipId ? { ...clip, favorite: original.favorite, notInteresting: original.notInteresting } : clip) } : current)
    }
  }
  const retry = async () => {
    setRetrying(true)
    try {
      const response = await fetch(`/api/projects/${id}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setProject(data.project)
      setConfirmRegeneration(false)
      setPollVersion((value) => value + 1)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Не удалось повторить обработку.",
      )
    } finally {
      setRetrying(false)
    }
  }
  const cancel = async () => {
    setCancelling(true)
    try {
      const response = await fetch(`/api/projects/${id}/cancel`, {
        method: "POST",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setProject(data.project)
      setPollVersion((value) => value + 1)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Не удалось остановить обработку.",
      )
    } finally {
      setCancelling(false)
    }
  }
  const remove = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(
        deleteTarget.type === "project"
          ? `/api/projects/${deleteTarget.id}`
          : `/api/clips/${deleteTarget.id}`,
        { method: "DELETE" },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Не удалось удалить.")
      }
      if (deleteTarget.type === "project") {
        router.push("/")
        router.refresh()
        return
      }
      setProject((current) =>
        current
          ? {
              ...current,
              clips: current.clips.filter(
                (clip) => clip.id !== deleteTarget.id,
              ),
            }
          : current,
      )
      setDeleteTarget(null)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Не удалось удалить.",
      )
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }
  const openEditor = async (clip: { id: string; title: string }) => {
    setEditClip(clip)
    setEditor(null)
    setEditorError("")
    try {
      const response = await fetch(`/api/clips/${clip.id}/edit`, {
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setEditor(data.settings)
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "Не удалось открыть редактор.",
      )
    }
  }
  const saveEditor = async () => {
    if (!editClip || !editor) return
    setSavingEdit(true)
    setEditorError("")
    try {
      const response = await fetch(`/api/clips/${editClip.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setEditClip(null)
      setEditor(null)
      setMediaVersion((value) => value + 1)
      setPollVersion((value) => value + 1)
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "Не удалось сохранить клип.",
      )
    } finally {
      setSavingEdit(false)
    }
  }
  return (
    <section className={styles.page}>
      <a className={styles.back} href={project.kind === 'montage' ? '/montage' : '/'}>
        ← {project.kind === 'montage' ? 'Динамичный монтаж' : 'Проекты'}
      </a>
      <header>
        <div>
          <span className={styles.kicker}>{project.kind === 'montage' ? 'ДИНАМИЧНЫЙ МОНТАЖ' : 'ПРОЕКТ YOUTUBE'}</span>
          <h1>{project.title ?? "Подготавливаем видео…"}</h1>
          <a href={project.sourceUrl} target='_blank' rel='noreferrer'>
            youtube.com/watch?v={project.videoId}
          </a>
        </div>
        <span className={`${styles.badge} ${styles[project.status]}`}>
          {stageLabels[project.status]}
        </span>
      </header>
      {isActive && (
        <div className={styles.waveBlock}>
          <div className={styles.waveHeader}>
            <strong>{stageLabels[project.status]}</strong>
            <span>{progressValue}%</span>
          </div>
          <div
            className={styles.waveTrack}
            role='progressbar'
            aria-label={stageLabels[project.status]}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
          >
            <div
              className={styles.waveFill}
              style={{ width: `${progressValue}%` }}
            >
              <i />
              <b />
            </div>
          </div>
          <small>
            {activeIndex >= 0
              ? `Этап ${activeIndex + 1} из ${steps.length}`
              : "Ожидает запуска"}
            . Можно оставить страницу открытой — статус обновляется
            автоматически.
          </small>
        </div>
      )}
      {isActive && (
        <div className={styles.progress}>
          {steps.map((step, index) => (
            <div key={step} className={index <= activeIndex ? styles.done : ""}>
              <span>{index < activeIndex ? "✓" : index + 1}</span>
              <small>{stageLabels[step]}</small>
            </div>
          ))}
        </div>
      )}
      <div className={styles.projectMeta}>
        <strong>Параметры проекта</strong>
        <div>
          {isActive && (
            <button
              className={styles.cancel}
              type='button'
              disabled={cancelling || project.status === "cancelling"}
              onClick={cancel}
            >
              {project.status === "cancelling" || cancelling
                ? "Останавливаем…"
                : "Остановить обработку"}
            </button>
          )}
          {project.status === "completed" && (
            <button
              className={styles.regenerate}
              type='button'
              disabled={retrying}
              onClick={() => setConfirmRegeneration(true)}
            >
              Сгенерировать заново
            </button>
          )}
          <button
            className={styles.deleteProject}
            type='button'
            disabled={isActive}
            title={isActive ? "Сначала остановите обработку" : undefined}
            onClick={() =>
              setDeleteTarget({
                type: "project",
                id: project.id,
                title: project.title ?? "проект",
              })
            }
          >
            Удалить проект
          </button>
        </div>
      </div>
      <div className={styles.settingsSummary}>
        <div>
          <span>Формат</span>
          <strong>{project.aspectRatio} · {formatLabels[project.aspectRatio]}</strong>
          <small>{formatDimensions[project.aspectRatio]}</small>
        </div>
        <div>
          <span>Клипы</span>
          <strong>До {project.requestedClips} сюжетов</strong>
          <small>{project.kind === 'montage' ? 'несколько склеек в каждом клипе' : project.clips.length ? `${project.clips.length} файлов · ${lengthLabels[project.clipLength]}` : lengthLabels[project.clipLength]}</small>
        </div>
        <div>
          <span>Субтитры</span>
          <strong>{project.subtitles ? captionLabels[project.captionStyle] : "Выключены"}</strong>
          <small>{project.subtitles ? <><i className={styles.colorDot} style={{ background: project.subtitleColor }} />{project.wordHighlight ? "пословная подсветка" : "обычный текст"}</> : "без оформления"}</small>
        </div>
        <div className={project.autoReframe ? styles.enabledSetting : undefined}>
          <span>Кадрирование</span>
          <strong>{project.autoReframe ? "AI включено" : "Полный кадр"}</strong>
          <small>{project.autoReframe ? "ведение говорящего" : project.fitBackground === "blur" ? "размытый фон" : "чёрный фон"}</small>
        </div>
        <div className={project.addBroll ? styles.enabledSetting : undefined}>
          <span>AI B-roll</span>
          <strong>{project.addBroll ? "Включён" : "Выключен"}</strong>
          <small>{project.addBroll ? "Kimi + Pexels" : "без вставок"}</small>
        </div>
        <div className={project.adhdMode ? styles.enabledSetting : undefined}>
          <span>СДВГ-клип</span>
          <strong>{project.adhdMode ? "Включён" : "Выключен"}</strong>
          <small>{project.adhdMode ? project.adhdGameplay?.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ') : "без игрового фона"}</small>
        </div>
        <div>
          <span>Эффекты субтитров</span>
          <strong>{project.highlightKeywords || project.addEmojis || project.autoCensor ? "Включены" : "Выключены"}</strong>
          <small>{[project.highlightKeywords && "подсветка ключевых слов", project.addEmojis && "эмодзи", project.autoCensor && "автоцензор"].filter(Boolean).join(" · ") || "без дополнительных эффектов"}</small>
        </div>
      </div>
      {project.clipPrompt && (
        <div className={styles.searchBrief}>
          <span>Искомый момент</span>
          <strong>{project.clipPrompt}</strong>
          <small>
            {project.status === "selecting"
              ? "ИИ сравнивает запрос с кандидатами…"
              : "Запрос учитывается при выборе и ранжировании клипов."}
          </small>
        </div>
      )}
      {project.sourceDuration &&
        project.sourceDuration > (project.analyzedDuration ?? 0) && (
          <p className={styles.notice}>
            Сейчас анализируются первые{" "}
            {Math.round((project.analyzedDuration ?? 0) / 60)} минут из{" "}
            {Math.round(project.sourceDuration / 60)}.
          </p>
        )}
      {project.status === 'review' && (project.kind === 'montage' ? <MontageReview projectId={project.id} onApproved={() => setPollVersion(value => value + 1)} /> : <CandidateReview projectId={project.id} onApproved={() => setPollVersion(value => value + 1)} />)}
      {project.error && (
        <div className={styles.error}>
          <strong>
            {project.clips.length
              ? "Часть клипов готова"
              : "Обработка остановлена"}
          </strong>
          <p>{project.error}</p>
          <button disabled={retrying} onClick={retry}>
            {retrying
              ? "Запускаем…"
              : project.clips.length
                ? "Повторить недостающие"
                : "Повторить"}
          </button>
        </div>
      )}
      {project.status === "cancelled" && (
        <div className={styles.error}>
          <strong>Обработка отменена</strong>
          <p>
            Сохранённые исходники и расшифровка останутся для быстрого
            повторного запуска.
          </p>
          <button disabled={retrying} onClick={retry}>
            {retrying ? "Запускаем…" : "Запустить снова"}
          </button>
        </div>
      )}
      {!!project.clips.length && (
        <div className={styles.clips}>
          {project.clips.map((clip) => (
            <article key={clip.id}>
              <video
                key={mediaVersion}
                controls
                preload='metadata'
                poster={`/api/clips/${clip.id}/preview?v=${mediaVersion}`}
              >
                <source
                  src={`/api/clips/${clip.id}/video?v=${mediaVersion}`}
                  type='video/mp4'
                />
              </video>
              <div className={styles.clipBody}>
                {(() => {
                  const publication = publications.find(item => item.clip_id === clip.id)
                  if (!publication) return null
                  return <div className={`${styles.publicationStatus} ${styles[`publication_${publication.status}`] ?? ""}`}>
                    <span>YouTube</span>
                    {publication.status === "queued" ? "В очереди" : publication.status === "uploading" ? "Загружается…" : publication.status === "published" ? publication.remote_id ? <a href={`https://youtu.be/${publication.remote_id}`} target="_blank" rel="noreferrer">Опубликован ↗</a> : "Опубликован" : <button type="button" onClick={() => setPublishClip({ id: clip.id, title: clip.title })}>Ошибка · повторить</button>}
                  </div>
                })()}
                <span>
                  {Math.round(clip.renderedDuration ?? clip.end - clip.start)} сек. ·{" "}
                  {formatDimensions[project.aspectRatio]} ·{" "}
                  {formatSize(clip.sizeBytes) ?? "размер неизвестен"} ·{" "}
                  {clip.subtitles ? "с субтитрами" : "без субтитров"}
                </span>
                {clip.seriesPart != null && clip.seriesTotal != null && (
                  <div className={styles.seriesBadge}>
                    Одна история · часть {clip.seriesPart} из {clip.seriesTotal}
                  </div>
                )}
                <h2>{clip.title}</h2>
                {clip.viralPotential != null && (
                  <div
                    className={styles.potential}
                    title={`Хук: ${clip.hookScore ?? "—"} · Завершённость: ${clip.completenessScore ?? "—"} · Ценность: ${clip.valueScore ?? "—"}`}
                  >
                    <span>Потенциал</span>
                    <b>{clip.viralPotential}</b>
                  </div>
                )}
                {clip.queryMatch != null && (
                  <div className={styles.queryMatch}>
                    <i style={{ width: `${clip.queryMatch}%` }} />
                    <b>{clip.queryMatch}% по запросу</b>
                  </div>
                )}
                <p>{clip.reason}</p>
                {clip.brollSources.length > 0 && (
                  <div className={styles.brollCredits}>
                    <span>AI B-roll:</span>
                    {clip.brollSources.map((source) => (
                      <a
                        key={source.pageUrl}
                        href={source.pageUrl}
                        target='_blank'
                        rel='noreferrer'
                      >
                        {source.creator} · Pexels
                      </a>
                    ))}
                  </div>
                )}
                {clip.brollError && (
                  <div className={styles.brollWarning}>
                    AI B-roll: {clip.brollError}
                  </div>
                )}
                <div className={styles.clipActions}>
                  <button
                    className={styles.favoriteButton}
                    data-active={clip.favorite || undefined}
                    aria-pressed={clip.favorite}
                    aria-label={`${clip.favorite ? "Убрать из" : "Добавить в"} избранное: ${clip.title}`}
                    title={clip.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                    onClick={() => setClipReaction(clip.id, { favorite: !clip.favorite })}
                  >
                    <ActionIcon type='favorite' />
                  </button>
                  <button
                    className={styles.notInterestingButton}
                    data-active={clip.notInteresting || undefined}
                    aria-pressed={clip.notInteresting}
                    aria-label={`${clip.notInteresting ? "Убрать отметку" : "Отметить как"} неинтересное: ${clip.title}`}
                    title={clip.notInteresting ? "Отменить «Неинтересно»" : "Неинтересно"}
                    onClick={() => setClipReaction(clip.id, { notInteresting: !clip.notInteresting })}
                  >
                    <ActionIcon type='notInteresting' />
                  </button>
                  <a
                    href={`/api/clips/${clip.id}/video`}
                    download={`clip-${clip.id}.mp4`}
                    aria-label={`Скачать клип ${clip.title}`}
                    title='Скачать'
                  >
                    <ActionIcon type='download' />
                  </a>
                  <button
                    className={styles.publishButton}
                    type='button'
                    aria-label={`Опубликовать клип ${clip.title}`}
                    title='Опубликовать'
                    onClick={() => setPublishClip({ id: clip.id, title: clip.title })}
                  >
                    <ActionIcon type='publish' />
                  </button>
                  <button
                    className={styles.editButton}
                    type='button'
                    aria-label={`Редактировать клип ${clip.title}`}
                    title='Редактировать'
                    onClick={() => project.kind === 'montage' ? setMontageEditClip({ id: clip.id, title: clip.title }) : openEditor({ id: clip.id, title: clip.title })}
                  >
                    <ActionIcon type='edit' />
                  </button>
                  <button
                    className={styles.removeButton}
                    type='button'
                    aria-label={`Удалить клип ${clip.title}`}
                    title='Удалить'
                    onClick={() =>
                      setDeleteTarget({
                        type: "clip",
                        id: clip.id,
                        title: clip.title,
                      })
                    }
                  >
                    <ActionIcon type='delete' />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {project.status === "completed" && !project.clips.length && (
        <div className={styles.error}>Подходящие клипы не найдены.</div>
      )}
      <ConfirmDialog
        open={confirmRegeneration}
        title='Сгенерировать клипы заново?'
        description='Текущие клипы будут удалены и проект снова встанет в очередь. Исходное видео и расшифровка сохранятся, поэтому повторная обработка пройдёт быстрее.'
        confirmLabel='Сгенерировать'
        busy={retrying}
        onClose={() => setConfirmRegeneration(false)}
        onConfirm={retry}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.type === "project" ? "Удалить проект?" : "Удалить клип?"
        }
        description={
          deleteTarget?.type === "project"
            ? "Исходное видео, расшифровка и все клипы будут удалены без возможности восстановления."
            : `Клип «${deleteTarget?.title ?? ""}» будет удалён без возможности восстановления.`
        }
        busy={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
      <PublishDialog clip={publishClip} projectId={project.id} onClose={() => setPublishClip(null)} onPublicationChange={current => {
        setPublications(items => [current, ...items.filter(item => item.id !== current.id)])
        if (!["queued", "uploading"].includes(current.status)) setPublicationVersion(value => value + 1)
      }} />
      {montageEditClip && <div className={styles.editorBackdrop} role='presentation' onMouseDown={event => { if (event.target === event.currentTarget) setMontageEditClip(null) }}><section className={styles.editorDialog} role='dialog' aria-modal='true' aria-label={`Редактировать монтаж ${montageEditClip.title}`}><header><h2>{montageEditClip.title}</h2><button type='button' aria-label='Закрыть' onClick={() => setMontageEditClip(null)}>×</button></header><MontageReview projectId={project.id} clipId={montageEditClip.id} onApproved={() => { setMontageEditClip(null); setMediaVersion(value => value + 1); setPollVersion(value => value + 1) }} /></section></div>}
      {editClip && (
        <div
          className={styles.editorBackdrop}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingEdit)
              setEditClip(null)
          }}
        >
          <section
            className={styles.editorDialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby='clip-editor-title'
          >
            <header>
              <div>
                <span>РЕДАКТОР КЛИПА</span>
                <h2 id='clip-editor-title'>{editClip.title}</h2>
              </div>
              <button
                type='button'
                disabled={savingEdit}
                aria-label='Закрыть'
                onClick={() => setEditClip(null)}
              >
                ×
              </button>
            </header>
            {!editor ? (
              <p>{editorError || "Загружаем расшифровку…"}</p>
            ) : (
              <>
                <ClipVisualEditor
                  clipId={editClip.id}
                  value={editor}
                  onChange={(changes) => setEditor({ ...editor, ...changes })}
                />
                <label className={styles.editorToggle}>
                  <input
                    type='checkbox'
                    checked={editor.subtitles}
                    onChange={(event) =>
                      setEditor({ ...editor, subtitles: event.target.checked })
                    }
                  />
                  Добавить субтитры
                </label>
                <label className={styles.editorText}>
                  Текст субтитров
                  <textarea
                    rows={7}
                    maxLength={4000}
                    disabled={!editor.subtitles}
                    value={editor.subtitleText}
                    onChange={(event) =>
                      setEditor({ ...editor, subtitleText: event.target.value })
                    }
                  />
                </label>
                <div className={styles.transcriptEditor}>
                  <strong>Монтаж по расшифровке</strong>
                  <small>Отметьте фразы, которые нужно вырезать из видео и звука. Изменения применятся при сохранении клипа.</small>
                  <div className={styles.transcriptLines}>
                    {editor.transcript.map((line) => (
                      <label key={line.id} className={editor.cutSegments.includes(line.id) ? styles.cutLine : undefined}>
                        <input type='checkbox' checked={editor.cutSegments.includes(line.id)} onChange={(event) => setEditor({ ...editor, cutSegments: event.target.checked ? [...editor.cutSegments, line.id] : editor.cutSegments.filter(id => id !== line.id) })} />
                        <span>{Math.floor(line.start / 60)}:{String(Math.floor(line.start % 60)).padStart(2, '0')}</span>
                        <span>{line.text}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className={styles.editorFields}>
                  <label>
                    Стиль
                    <select
                      value={editor.captionStyle}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          captionStyle: event.target
                            .value as EditorSettings["captionStyle"],
                        })
                      }
                    >
                      {editorStyles.map((value) => (
                        <option key={value} value={value}>
                          {value === "mrbeast"
                            ? "Mr. Beast"
                            : value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset>
                    <legend>Цвет</legend>
                    {editorColors.map((color) => (
                      <button
                        key={color}
                        type='button'
                        aria-label={color}
                        aria-pressed={editor.subtitleColor === color}
                        style={{ background: color }}
                        onClick={() =>
                          setEditor({ ...editor, subtitleColor: color })
                        }
                      />
                    ))}
                  </fieldset>
                </div>
                <div className={styles.editorChecks}>
                  <label>
                    <input
                      type='checkbox'
                      checked={editor.wordHighlight}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          wordHighlight: event.target.checked,
                        })
                      }
                    />
                    Пословная подсветка
                  </label>
                  <label>
                    <input
                      type='checkbox'
                      checked={editor.highlightKeywords}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          highlightKeywords: event.target.checked,
                        })
                      }
                    />
                    Ключевые слова
                  </label>
                  <label>
                    <input
                      type='checkbox'
                      checked={editor.addEmojis}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          addEmojis: event.target.checked,
                        })
                      }
                    />
                    Эмодзи
                  </label>
                  <label>
                    <input
                      type='checkbox'
                      checked={editor.autoCensor}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          autoCensor: event.target.checked,
                        })
                      }
                    />
                    Автоцензор
                  </label>
                </div>
                {editor.autoReframe && !editor.manualCrop && (
                  <label className={styles.reframeOffset}>
                    <span>
                      <b>Положение кадра</b>
                      <small>
                        {editor.reframeOffset === 0
                          ? "По центру"
                          : editor.reframeOffset < 0
                            ? `Левее на ${Math.abs(Math.round(editor.reframeOffset * 100))}%`
                            : `Правее на ${Math.round(editor.reframeOffset * 100)}%`}
                      </small>
                    </span>
                    <input
                      type='range'
                      min='-35'
                      max='35'
                      step='1'
                      value={Math.round(editor.reframeOffset * 100)}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          reframeOffset: Number(event.target.value) / 100,
                        })
                      }
                    />
                    <button
                      type='button'
                      onClick={() => setEditor({ ...editor, reframeOffset: 0 })}
                    >
                      Сбросить
                    </button>
                  </label>
                )}
                {editorError && (
                  <p className={styles.editorError}>{editorError}</p>
                )}
                <footer>
                  <button
                    type='button'
                    disabled={savingEdit}
                    onClick={() => setEditClip(null)}
                  >
                    Отмена
                  </button>
                  <button
                    type='button'
                    disabled={savingEdit}
                    onClick={saveEditor}
                  >
                    {savingEdit ? "Рендерим…" : "Сохранить и перерендерить"}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
