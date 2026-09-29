"use client"
import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { getYouTubeVideoId } from "@/lib/youtube"
import styles from "./index.module.scss"

const captionColors = [
  { color: "#ffd400", label: "Жёлтые" },
  { color: "#28c76f", label: "Зелёные" },
  { color: "#43a5ff", label: "Синие" },
  { color: "#ffffff", label: "Белые" },
]

const captionTemplates = [
  {
    id: "default",
    label: "Default",
    image: "/assets/caption-default.png",
    words: ["ВАШЕ", "ВИДЕО"],
  },
  {
    id: "modern",
    label: "Modern",
    image: "/assets/caption-modern.png",
    words: ["ЭТО", "ВАЖНО"],
  },
  {
    id: "bouncy",
    label: "Bouncy",
    image: "/assets/caption-bouncy.png",
    words: ["ЛОВИ", "МОМЕНТ"],
  },
  {
    id: "mrbeast",
    label: "Mr. Beast",
    image: "/assets/caption-mrbeast.png",
    words: ["СМОТРИ", "СЮДА"],
  },
  {
    id: "business",
    label: "Business",
    image: "/assets/caption-business.png",
    words: ["Главная", "мысль"],
  },
] as const

type GameplayVideo = {
  id: string
  label: string
  url: string
  category: "minecraft" | "subway" | "cs" | "temple-run" | "other"
  categoryLabel: string
}

export function ProjectForm({
  defaultSubtitles = true,
  defaultReframe = false,
  brollAvailable = false,
  gameplayVideos = [],
}: {
  defaultSubtitles?: boolean
  defaultReframe?: boolean
  brollAvailable?: boolean
  gameplayVideos?: GameplayVideo[]
}) {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [subtitles, setSubtitles] = useState(defaultSubtitles)
  const [color, setColor] = useState(captionColors[0].color)
  const [captionStyle, setCaptionStyle] =
    useState<(typeof captionTemplates)[number]["id"]>("mrbeast")
  const [wordHighlight, setWordHighlight] = useState(true)
  const [highlightKeywords, setHighlightKeywords] = useState(false)
  const [addEmojis, setAddEmojis] = useState(false)
  const [autoCensor, setAutoCensor] = useState(false)
  const [clipPrompt, setClipPrompt] = useState("")
  const [autoReframe, setAutoReframe] = useState(defaultReframe)
  const [count, setCount] = useState(2)
  const [aspectRatio, setAspectRatio] = useState("9:16")
  const [fitBackground, setFitBackground] = useState<"black" | "blur">("black")
  const [clipLength, setClipLength] = useState("medium")
  const [addBroll, setAddBroll] = useState(false)
  const [adhdMode, setAdhdMode] = useState(false)
  const [adhdGameplay, setAdhdGameplay] = useState(gameplayVideos[0]?.id ?? "")
  const [adhdMainPosition, setAdhdMainPosition] = useState<
    "left" | "center" | "right"
  >("center")
  const [gameplayCategory, setGameplayCategory] = useState<
    GameplayVideo["category"]
  >(gameplayVideos[0]?.category ?? "subway")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!getYouTubeVideoId(url.trim())) {
      setMessage("Введите ссылку на видео YouTube")
      return
    }
    setSubmitting(true)
    setMessage("Создаём проект…")
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          subtitles,
          subtitleColor: color,
          captionStyle,
          wordHighlight,
          highlightKeywords,
          addEmojis,
          autoCensor,
          clipPrompt,
          count,
          autoReframe,
          aspectRatio,
          clipLength,
          fitBackground,
          addBroll,
          adhdMode,
          adhdGameplay,
          adhdMainPosition,
        }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || "Не удалось создать проект.")
      router.push(`/projects/${data.project.id}`)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось создать проект.",
      )
      setSubmitting(false)
    }
  }
  return (
    <>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.row}>
          <label htmlFor='video-url' className={styles.srOnly}>
            Ссылка на видео YouTube
          </label>
          <input
            id='video-url'
            type='url'
            required
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setMessage("")
            }}
            placeholder='Вставьте ссылку на видео YouTube…'
            aria-describedby='form-status'
          />
          <button type='submit' disabled={submitting}>
            {submitting ? "Запускаем…" : "Создать клипы"}
          </button>
        </div>
        <div className={styles.settingsRow}>
          <div className={styles.controls}>
            <strong>Автосубтитры:</strong>
            <button
              className={`${styles.switch} ${subtitles ? styles.switchOn : ""}`}
              type='button'
              role='switch'
              aria-label='Автосубтитры'
              aria-checked={subtitles}
              onClick={() => setSubtitles((value) => !value)}
            >
              <span />
            </button>
            <span>{subtitles ? "Вкл." : "Выкл."}</span>
          </div>
          <label
            className={styles.count}
            title='Для длинных видео итоговое количество автоматически увеличится'
          >
            Минимум клипов
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.outputSettings}>
          <label>
            Соотношение сторон
            <select
              value={aspectRatio}
              disabled={adhdMode}
              onChange={(event) => setAspectRatio(event.target.value)}
            >
              <option value='9:16'>9:16 · Shorts</option>
              <option value='1:1'>1:1 · Квадрат</option>
              <option value='4:5'>4:5 · Портрет</option>
              <option value='16:9'>16:9 · Широкий</option>
            </select>
          </label>
          <label>
            Длина клипов
            <select
              value={clipLength}
              onChange={(event) => setClipLength(event.target.value)}
            >
              <option value='short'>20–30 сек.</option>
              <option value='medium'>30–60 сек.</option>
              <option value='long'>60–90 сек.</option>
            </select>
          </label>
        </div>
        <label className={styles.clipPrompt}>
          <span>
            Найти момент <small>необязательно</small>
          </span>
          <input
            type='text'
            maxLength={300}
            value={clipPrompt}
            onChange={(event) => setClipPrompt(event.target.value)}
            placeholder='Например: когда обсуждают рост канала или дают практический совет'
          />
        </label>
        <label className={styles.reframe}>
          <input
            type='checkbox'
            checked={autoReframe}
            onChange={(event) => setAutoReframe(event.target.checked)}
          />
          <span>AI-кадрирование</span>
          <small>Автоведение лица на поддерживаемых устройствах</small>
        </label>
        <label
          className={`${styles.reframe} ${!brollAvailable ? styles.unavailable : ""}`}
          title={
            brollAvailable ? undefined : "Для включения добавьте PEXELS_API_KEY"
          }
        >
          <input
            type='checkbox'
            checked={addBroll}
            disabled={!brollAvailable}
            onChange={(event) => setAddBroll(event.target.checked)}
          />
          <span>AI B-roll</span>
          <small>
            {brollAvailable
              ? "Kimi подберёт визуальные вставки из Pexels"
              : "Требуется PEXELS_API_KEY"}
          </small>
        </label>
        <section className={styles.adhdSettings} aria-labelledby='adhd-title'>
          <label
            className={`${styles.reframe} ${!gameplayVideos.length ? styles.unavailable : ""}`}
          >
            <input
              type='checkbox'
              checked={adhdMode}
              disabled={!gameplayVideos.length}
              onChange={(event) => {
                const enabled = event.target.checked
                setAdhdMode(enabled)
                if (enabled) {
                  setAspectRatio("9:16")
                  setAdhdGameplay(
                    (value) => value || gameplayVideos[0]?.id || "",
                  )
                }
              }}
            />
            <span id='adhd-title'>СДВГ-клип</span>
            <small>Основной клип сверху, залипательный геймплей снизу</small>
          </label>
          {!gameplayVideos.length && (
            <p>
              Добавьте подготовленные MP4 или WebM в{" "}
              <code>public/gameplay</code>.
            </p>
          )}
          {adhdMode && (
            <div className={styles.gameplayPicker}>
              <div className={styles.mainPosition}>
                <span>Центрирование основного видео</span>
                <div>
                  {(
                    [
                      ["left", "Слева"],
                      ["center", "По центру"],
                      ["right", "Справа"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type='button'
                      aria-pressed={adhdMainPosition === value}
                      onClick={() => setAdhdMainPosition(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.gameplayTabs}>
                {Array.from(
                  new Map(
                    gameplayVideos.map((video) => [
                      video.category,
                      video.categoryLabel,
                    ]),
                  ).entries(),
                ).map(([category, label]) => (
                  <button
                    key={category}
                    type='button'
                    aria-pressed={gameplayCategory === category}
                    onClick={() => {
                      setGameplayCategory(category)
                      const first = gameplayVideos.find(
                        (video) => video.category === category,
                      )
                      if (first) setAdhdGameplay(first.id)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.gameplayGrid}>
                {gameplayVideos
                  .filter((video) => video.category === gameplayCategory)
                  .map((video) => (
                    <button
                      key={video.id}
                      type='button'
                      aria-pressed={adhdGameplay === video.id}
                      onClick={() => setAdhdGameplay(video.id)}
                      onMouseEnter={(event) => {
                        void event.currentTarget.querySelector("video")?.play()
                      }}
                      onMouseLeave={(event) => {
                        const preview =
                          event.currentTarget.querySelector("video")
                        if (preview) {
                          preview.pause()
                          preview.currentTime = 0
                        }
                      }}
                    >
                      <video
                        src={video.url}
                        muted
                        loop
                        playsInline
                        preload='metadata'
                      />
                      <span>{video.label}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </section>
        {!autoReframe && (
          <fieldset className={styles.fitBackground}>
            <legend>Фон при вписывании видео</legend>
            <button
              type='button'
              aria-pressed={fitBackground === "black"}
              onClick={() => setFitBackground("black")}
            >
              <i className={styles.fitBlack} />
              <span>Чёрный фон</span>
            </button>
            <button
              type='button'
              aria-pressed={fitBackground === "blur"}
              onClick={() => setFitBackground("blur")}
            >
              <i className={styles.fitBlur} />
              <span>Blur-фон</span>
            </button>
          </fieldset>
        )}
        <p id='form-status' role='status' className={styles.status}>
          {message}
        </p>
      </form>
      {subtitles && (
        <section
          className={styles.captionStyles}
          aria-labelledby='caption-style-title'
        >
          <h2 id='caption-style-title'>Стиль субтитров</h2>
          <div className={styles.captionGrid}>
            {captionTemplates.map((item) => (
              <button
                key={item.id}
                type='button'
                aria-label={`Стиль ${item.label}`}
                aria-pressed={item.id === captionStyle}
                onClick={() => setCaptionStyle(item.id)}
              >
                <span
                  className={`${styles.captionPreview} ${styles[`caption_${item.id}`]}`}
                >
                  <Image
                    src={item.image}
                    alt=''
                    fill
                    sizes='(max-width: 620px) 42vw, 112px'
                  />
                  <b style={{ color }}>
                    {item.words.map((word, index) => (
                      <i
                        key={word}
                        className={index === 0 ? styles.activeWord : undefined}
                      >
                        {word}
                      </i>
                    ))}
                  </b>
                </span>
                <span className={styles.captionLabel}>{item.label}</span>
              </button>
            ))}
          </div>
          <div className={styles.captionColors} aria-label='Цвет субтитров'>
            {captionColors.map((item) => (
              <button
                key={item.color}
                type='button'
                aria-label={item.label}
                aria-pressed={item.color === color}
                title={item.label}
                onClick={() => setColor(item.color)}
              >
                <span style={{ backgroundColor: item.color }} />
              </button>
            ))}
          </div>
          <div className={styles.captionEffects}>
            <label>
              <input
                type='checkbox'
                checked={wordHighlight}
                onChange={(event) => setWordHighlight(event.target.checked)}
              />
              <span>Пословная подсветка</span>
            </label>
            <label>
              <input
                type='checkbox'
                checked={highlightKeywords}
                onChange={(event) => setHighlightKeywords(event.target.checked)}
              />
              <span>Выделять ключевые слова</span>
            </label>
            <label>
              <input
                type='checkbox'
                checked={addEmojis}
                onChange={(event) => setAddEmojis(event.target.checked)}
              />
              <span>Добавлять эмодзи</span>
            </label>
            <label>
              <input
                type='checkbox'
                checked={autoCensor}
                onChange={(event) => setAutoCensor(event.target.checked)}
              />
              <span>Автоцензор</span>
            </label>
          </div>
        </section>
      )}
    </>
  )
}
