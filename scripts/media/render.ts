import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { tmpdir } from "node:os"
import { cleanTranscriptText, run, type Segment } from "./core"
import type {
  AspectRatio,
  CaptionStyle,
  FitBackground,
} from "../../src/lib/project-types"

export interface SubtitleCue {
  start: number
  end: number
  text: string
}
export interface SubjectPoint {
  time: number
  centerX: number
  confidence: number
  width?: number
  speakerId?: number
  sceneCut?: boolean
}
export interface ManualCrop {
  x: number
  y: number
  width: number
  height: number
}
export interface TextOverlay {
  id: string
  text: string
  x: number
  y: number
  fontFamily: "Montserrat" | "Russo One" | "Arial" | "Bahnschrift"
  fontSize: number
  color: string
  backgroundColor: string
  backgroundOpacity: number
  bold: boolean
  start: number
  end: number
}
const MAX_CAPTION_WORDS = 2
const formatProfiles: Record<
  AspectRatio,
  {
    width: number
    height: number
    captionScale: number
    marginH: number
    marginV: number
  }
> = {
  "9:16": {
    width: 720,
    height: 1280,
    captionScale: 1,
    marginH: 42,
    marginV: 185,
  },
  "1:1": {
    width: 1080,
    height: 1080,
    captionScale: 0.88,
    marginH: 70,
    marginV: 120,
  },
  "4:5": {
    width: 864,
    height: 1080,
    captionScale: 0.92,
    marginH: 54,
    marginV: 135,
  },
  "16:9": {
    width: 1280,
    height: 720,
    captionScale: 0.72,
    marginH: 90,
    marginV: 72,
  },
}

/** Literal text only: never allow ASS override tags, line escapes or injected events. */
export function escapeAssText(text: string): string {
  return cleanTranscriptText(text)
    .replace(/\\/g, "＼")
    .replace(/{/g, "｛")
    .replace(/}/g, "｝")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function assTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Некорректное время субтитров.")
  const total = Math.round(seconds * 100)
  return `${Math.floor(total / 360000)}:${String(Math.floor(total / 6000) % 60).padStart(2, "0")}:${String(Math.floor(total / 100) % 60).padStart(2, "0")}.${String(total % 100).padStart(2, "0")}`
}

/** Builds captions from complete recognized words so tokenizer fragments never split a word. */
export function subtitleCues(
  segments: Segment[],
  start: number,
  end: number,
): SubtitleCue[] {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start
  )
    throw new Error("Некорректные границы клипа.")
  const cues: SubtitleCue[] = []
  for (const segment of segments) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.end <= segment.start ||
      typeof segment.text !== "string"
    )
      throw new Error("Некорректный сегмент субтитров.")
    if (segment.end <= start || segment.start >= end) continue
    const alignedWords = segment.words?.filter(
      (word) =>
        word.end > start &&
        word.start < end &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start &&
        escapeAssText(word.text),
    )
    if (alignedWords?.length) {
      for (
        let index = 0;
        index < alignedWords.length;
        index += MAX_CAPTION_WORDS
      ) {
        const group = alignedWords.slice(index, index + MAX_CAPTION_WORDS)
        const from = Math.max(group[0].start, start) - start
        const to = Math.min(group.at(-1)!.end, end) - start
        const groupText = escapeAssText(
          group.map((word) => word.text).join(" "),
        )
        if (groupText && to - from >= 0.02)
          cues.push({ start: from, end: to, text: groupText })
      }
      continue
    }
    const text = escapeAssText(segment.text)
    const words = text.match(/\S+/gu) ?? []
    const chunks: string[] = []
    for (let index = 0; index < words.length; index += MAX_CAPTION_WORDS)
      chunks.push(words.slice(index, index + MAX_CAPTION_WORDS).join(" "))
    const weight = chunks.reduce((sum, item) => sum + item.length, 0)
    let cursor = segment.start
    for (const item of chunks) {
      const next =
        cursor + ((segment.end - segment.start) * item.length) / weight
      const from = Math.max(cursor, start) - start
      const to = Math.min(next, end) - start
      if (to - from >= 0.02) cues.push({ start: from, end: to, text: item })
      cursor = next
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function assColor(hex = "#ffffff"): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex))
    throw new Error("Некорректный цвет субтитров.")
  const [red, green, blue] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
  return `&H00${blue}${green}${red}`.toUpperCase()
}

const keywordStopWords = new Set([
  "это",
  "как",
  "что",
  "чтобы",
  "когда",
  "если",
  "или",
  "для",
  "так",
  "там",
  "тут",
  "уже",
  "ещё",
  "еще",
  "вот",
  "его",
  "она",
  "они",
  "мы",
  "вы",
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "your",
  "you",
])
const profanity =
  /^(?:бля|бляд|блять|сука|суки|суч|хуй|хуе|хуё|пизд|еба|ёба|ебу|ёбу|нахуй|мудак|долбо|fuck|shit|bitch|cunt|motherfuck)/iu

function normalizedWord(text: string) {
  return text.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, "")
}
function isProfane(text: string) {
  return profanity.test(normalizedWord(text))
}
function censorWord(text: string) {
  if (!isProfane(text)) return text
  const match = text.match(/[\p{L}\p{N}]/u)
  return match ? `${text.slice(0, match.index)}${match[0]}***` : "***"
}
function isKeyword(text: string) {
  const word = normalizedWord(text)
  return (word.length >= 6 && !keywordStopWords.has(word)) || /\d/u.test(word)
}
function cueEmoji(text: string) {
  const word = normalizedWord(text)
  if (/(деньг|цен|руб|доллар|миллион|богат|money|price)/u.test(word))
    return "💰"
  if (/(огонь|жар|fire)/u.test(word)) return "🔥"
  if (/(иде|важн|главн|совет|idea|important)/u.test(word)) return "💡"
  if (/(быстр|скорост|fast|quick)/u.test(word)) return "⚡"
  if (/(смех|смеш|шут|laugh|funny)/u.test(word)) return "😂"
  if (/(люб|серд|love)/u.test(word)) return "❤️"
  if (/(побед|успех|лучш|win|success|best)/u.test(word)) return "🏆"
  if (/(опас|вниман|ошиб|danger|warning)/u.test(word)) return "⚠️"
  return ""
}

const captionStyleConfig: Record<
  CaptionStyle,
  {
    font: string
    size: number
    outline: number
    shadow: number
    border: number
    spacing: number
    back: string
    effect: string
  }
> = {
  default: {
    font: "Arial",
    size: 58,
    outline: 4,
    shadow: 1,
    border: 1,
    spacing: 0,
    back: "&H70000000",
    effect: "{\\fad(70,70)}",
  },
  modern: {
    font: "Bahnschrift",
    size: 72,
    outline: 5,
    shadow: 2,
    border: 1,
    spacing: 0.5,
    back: "&H70000000",
    effect: "{\\fad(55,55)}",
  },
  bouncy: {
    font: "Montserrat",
    size: 76,
    outline: 6,
    shadow: 3,
    border: 1,
    spacing: 0.5,
    back: "&H70000000",
    effect:
      "{\\fscx82\\fscy82\\t(0,180,\\fscx108\\fscy108)\\t(180,280,\\fscx100\\fscy100)}",
  },
  mrbeast: {
    font: "Komika Title",
    size: 78,
    outline: 6,
    shadow: 3,
    border: 1,
    spacing: 1,
    back: "&H70000000",
    effect:
      "{\\fscx88\\fscy88\\t(0,150,\\fscx105\\fscy105)\\t(150,240,\\fscx100\\fscy100)}",
  },
  business: {
    font: "Bahnschrift",
    size: 58,
    outline: 10,
    shadow: 0,
    border: 3,
    spacing: 0,
    back: "&H00000000",
    effect: "{\\fad(90,90)}",
  },
}

export function buildAss(
  segments: Segment[],
  start: number,
  end: number,
  subtitleColor = "#ffffff",
  captionStyle: CaptionStyle = "modern",
  aspectRatio: AspectRatio = "9:16",
  wordHighlight = true,
  highlightKeywords = false,
  addEmojis = false,
  autoCensor = false,
): string {
  const color = assColor(subtitleColor)
  const style = captionStyleConfig[captionStyle]
  const baseColor = captionStyle === "business" ? "&H00252525" : color
  const outlineColor = captionStyle === "business" ? "&H18FFFFFF" : "&H00080808"
  const format = formatProfiles[aspectRatio]
  const fontSize = Math.round(style.size * format.captionScale)
  const outline = Math.max(
    style.outline ? 2 : 0,
    Math.round(style.outline * format.captionScale),
  )
  const shadow = Math.round(style.shadow * format.captionScale)
  const secondary = wordHighlight
    ? captionStyle === "business"
      ? "&H006F6F6F"
      : "&H88FFFFFF"
    : baseColor
  const keywordColor = assColor(
    subtitleColor.toLowerCase() === "#ffd400" ? "#7cff4f" : "#ffd400",
  )
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${format.width}\nPlayResY: ${format.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n; Captions are built from complete recognized words.\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${style.font},${fontSize},${baseColor},${secondary},${outlineColor},${style.back},-1,0,0,0,100,100,${style.spacing},0,${style.border},${outline},${shadow},2,${format.marginH},${format.marginH},${format.marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  return (
    header +
    subtitleCues(segments, start, end)
      .map((cue) => {
        const rawWords = cue.text.split(/\s+/u).filter(Boolean)
        const duration = Math.max(
          1,
          Math.round(
            ((cue.end - cue.start) * 100) / Math.max(1, rawWords.length),
          ),
        )
        const renderedWords = rawWords.map((raw) => {
          const visible = escapeAssText(autoCensor ? censorWord(raw) : raw)
          const emphasis =
            highlightKeywords && isKeyword(raw)
              ? `{\\1c${keywordColor}}`
              : `{\\1c${baseColor}}`
          const scriptFont =
            captionStyle === "mrbeast"
              ? `{\\fn${/[а-яё]/iu.test(raw) ? "Russo One" : "Komika Title"}}`
              : ""
          return `${wordHighlight ? `{\\k${duration}}` : ""}${emphasis}${scriptFont}${visible}`
        })
        const emoji = addEmojis ? rawWords.map(cueEmoji).find(Boolean) : ""
        const text = `${renderedWords.join(" ")}${emoji ? ` {\\fnSegoe UI Emoji}${emoji}{\\fn${style.font}}` : ""}`
        return `Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Default,,0,0,0,,${style.effect}${text}\n`
      })
      .join("")
  )
}

function assColorWithAlpha(hex: string, opacity: number) {
  const color = assColor(hex).slice(4)
  const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()
  return `&H${alpha}${color}`
}

export function buildTextOverlayAss(overlays: TextOverlay[], duration: number, aspectRatio: AspectRatio) {
  const format = formatProfiles[aspectRatio]
  const styles = overlays.map((overlay, index) => {
    const hasBackground = overlay.backgroundOpacity > 0
    return `Style: Overlay${index},${overlay.fontFamily},${overlay.fontSize},${assColor(overlay.color)},${assColor(overlay.color)},&H70000000,${assColorWithAlpha(overlay.backgroundColor, overlay.backgroundOpacity)},${overlay.bold ? -1 : 0},0,0,0,100,100,0,0,${hasBackground ? 3 : 1},${hasBackground ? 10 : 1},1,5,20,20,20,1`
  }).join("\n")
  const events = overlays.map((overlay, index) => {
    const x = Math.round(overlay.x * format.width)
    const y = Math.round(overlay.y * format.height)
    const text = overlay.text.split(/\r?\n/u).map(escapeAssText).filter(Boolean).join("\\N")
    return `Dialogue: ${10 + index},${assTimestamp(Math.max(0, overlay.start))},${assTimestamp(Math.min(duration, overlay.end))},Overlay${index},,0,0,0,,{\\an5\\pos(${x},${y})}${text}`
  }).join("\n")
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${format.width}\nPlayResY: ${format.height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styles}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
}

function censoredAudioFilter(segments: Segment[], start: number, end: number) {
  const ranges = segments
    .flatMap((segment) => segment.words ?? [])
    .filter(
      (word) => word.end > start && word.start < end && isProfane(word.text),
    )
    .map((word) => ({
      start: Math.max(0, word.start - start - 0.03),
      end: Math.min(end - start, word.end - start + 0.03),
    }))
  return ranges
    .map(
      (range) =>
        `volume=enable='between(t\\,${range.start.toFixed(3)}\\,${range.end.toFixed(3)})':volume=0`,
    )
    .join(",")
}

function cropX(center: string) {
  return `max(0\\,min(iw-ow\\,iw*(${center})-ow/2))`
}

export function reframeFilter(
  track: SubjectPoint[],
  start: number,
  end: number,
  aspectRatio: AspectRatio = "9:16",
  centerOffset = 0,
) {
  const format = formatProfiles[aspectRatio]
  const ratio = format.width / format.height
  const crop = `crop=w='min(iw\\,ih*${ratio.toFixed(8)})':h='min(ih\\,iw/${ratio.toFixed(8)})'`
  const safeOffset = Math.min(0.35, Math.max(-0.35, centerOffset))
  const points = track
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        Number.isFinite(point.centerX) &&
        point.centerX >= 0 &&
        point.centerX <= 1 &&
        point.time >= start - 8 &&
        point.time <= end + 8,
    )
    .sort((a, b) => a.time - b.time)
    .map((point) => ({
      ...point,
      centerX: Math.min(0.98, Math.max(0.02, point.centerX + safeOffset)),
      time: Math.max(0, point.time - start),
    }))
  if (!points.length)
    return `${crop}:x='(iw-ow)/2':y='max(0\\,(ih-oh)*0.38)',scale=${format.width}:${format.height}:flags=lanczos,setsar=1`
  if (points[0].time > 0) points.unshift({ ...points[0], time: 0 })
  let expression = cropX(points.at(-1)!.centerX.toFixed(5))
  for (let index = points.length - 2; index >= 0; index--) {
    const current = points[index]
    const next = points[index + 1]
    const span = Math.max(0.01, next.time - current.time)
    const center = `${current.centerX.toFixed(5)}+${(next.centerX - current.centerX).toFixed(5)}*(t-${current.time.toFixed(3)})/${span.toFixed(3)}`
    expression = `if(lt(t\\,${next.time.toFixed(3)})\\,${cropX(center)}\\,${expression})`
  }
  return `${crop}:x='${expression}':y='max(0\\,(ih-oh)*0.38)',scale=${format.width}:${format.height}:flags=lanczos,setsar=1`
}

export interface RenderClipOptions {
  sourcePath: string
  outputDirectory: string
  start: number
  end: number
  segments: Segment[]
  subtitles: boolean
  subtitleColor?: string
  captionStyle?: CaptionStyle
  wordHighlight?: boolean
  highlightKeywords?: boolean
  addEmojis?: boolean
  autoCensor?: boolean
  processingMode?: "eco" | "fast"
  subjectTrack?: SubjectPoint[]
  autoReframe?: boolean
  aspectRatio?: AspectRatio
  fitBackground?: FitBackground
  cover?: boolean
  watermark?: boolean
  manualCrop?: ManualCrop | null
  textOverlays?: TextOverlay[]
  reframeOffset?: number
  punchIn?: boolean
  flash?: boolean
  accentArrow?: { x: number; y: number } | null
  audioEdgeFade?: boolean
  minDuration?: number
  maxDuration?: number
  signal?: AbortSignal
}

function ffmpegFilterPath(file: string) {
  return path
    .resolve(file)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
}

/** Returns final MP4 path; sibling .jpg is its preview. Outputs use unique filenames. */
export async function renderClip({
  sourcePath,
  outputDirectory,
  start,
  end,
  segments,
  subtitles,
  subtitleColor = "#ffffff",
  captionStyle = "modern",
  wordHighlight = true,
  highlightKeywords = false,
  addEmojis = false,
  autoCensor = false,
  processingMode = "fast",
  subjectTrack = [],
  autoReframe = false,
  aspectRatio = "9:16",
  fitBackground = "black",
  cover = false,
  watermark: includeWatermark = true,
  manualCrop = null,
  textOverlays = [],
  reframeOffset = 0,
  punchIn = false,
  flash = false,
  accentArrow = null,
  audioEdgeFade = false,
  minDuration = 20,
  maxDuration = 90,
  signal,
}: RenderClipOptions): Promise<string> {
  const duration = end - start
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    duration < minDuration ||
    duration > maxDuration
  )
    throw new Error(
      `Длительность клипа должна быть от ${minDuration} до ${maxDuration} секунд.`,
    )
  const format = formatProfiles[aspectRatio]
  const dimensions = [format.width, format.height]
  const source = path.resolve(sourcePath)
  const watermark = path.resolve(
    process.env.CLIP_WATERMARK_PATH ??
      "output/branding/ava.jpg",
  )
  if (!(await stat(source)).isFile())
    throw new Error("Исходное видео не найдено.")
  if (includeWatermark && !(await stat(watermark)).isFile())
    throw new Error("Аватарка для вотермарки не найдена.")
  const output = path.resolve(outputDirectory)
  await mkdir(output, { recursive: true })
  const basename = `clip-${randomUUID()}`
  const partial = path.join(output, `${basename}.partial.mp4`)
  const final = path.join(output, `${basename}.mp4`)
  const previewPartial = path.join(output, `${basename}.partial.jpg`)
  const preview = path.join(output, `${basename}.jpg`)
  // Controlled ASCII path avoids FFmpeg filter-language escaping of caller paths.
  const temporary = await mkdtemp(path.join(tmpdir(), "clip-render-"))
  const options = { signal, timeoutMs: 600_000 }
  try {
    const fitFilter = cover
      ? `scale=${dimensions[0]}:${dimensions[1]}:force_original_aspect_ratio=increase,crop=${dimensions[0]}:${dimensions[1]},setsar=1`
      : fitBackground === "blur"
        ? `split=2[background][foreground];[background]scale=${dimensions[0]}:${dimensions[1]}:force_original_aspect_ratio=increase,crop=${dimensions[0]}:${dimensions[1]},boxblur=24:2[blurred];[foreground]scale=${dimensions[0]}:${dimensions[1]}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit];[blurred][fit]overlay=(W-w)/2:(H-h)/2,setsar=1`
        : `scale=${dimensions[0]}:${dimensions[1]}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${dimensions[0]}:${dimensions[1]}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`
    const manualCropFilter = manualCrop
      ? `crop=w='max(2,trunc(iw*${manualCrop.width.toFixed(6)}/2)*2)':h='max(2,trunc(ih*${manualCrop.height.toFixed(6)}/2)*2)':x='min(iw-ow,max(0,iw*${manualCrop.x.toFixed(6)}))':y='min(ih-oh,max(0,ih*${manualCrop.y.toFixed(6)}))',scale=${dimensions[0]}:${dimensions[1]}:flags=lanczos,setsar=1`
      : null
    let filter = manualCropFilter ?? (autoReframe
      ? reframeFilter(subjectTrack, start, end, aspectRatio, reframeOffset)
      : fitFilter)
    if (punchIn) filter += `,crop=trunc(iw*0.92/2)*2:trunc(ih*0.92/2)*2:(iw-ow)/2:(ih-oh)/2,scale=${dimensions[0]}:${dimensions[1]}:flags=lanczos,setsar=1`
    if (flash) filter += ",drawbox=x=0:y=0:w=iw:h=ih:color=white@0.40:t=fill:enable='lt(t,0.10)'"
    if (accentArrow && Number.isFinite(accentArrow.x) && Number.isFinite(accentArrow.y)) {
      const arrowAss = path.join(temporary, "accent-arrow.ass")
      const x = Math.round(Math.min(0.85, Math.max(0.25, accentArrow.x)) * dimensions[0] - 100)
      const y = Math.round(Math.min(0.72, Math.max(0.15, accentArrow.y)) * dimensions[1] - 15)
      const arrow = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${dimensions[0]}\nPlayResY: ${dimensions[1]}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Arrow,Arial,24,&H0000D4FF,&H0000D4FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 9,0:00:00.08,${assTimestamp(Math.min(1.35, duration))},Arrow,,0,0,0,,{\\an7\\pos(${x},${y})\\p1}m 0 10 l 66 10 66 0 100 24 66 48 66 38 0 38{\\p0}\n`
      await writeFile(arrowAss, arrow, "utf8")
      filter += `,ass=filename='${ffmpegFilterPath(arrowAss)}'`
    }
    if (textOverlays.length) {
      const overlaysAss = path.join(temporary, "text-overlays.ass")
      await writeFile(overlaysAss, buildTextOverlayAss(textOverlays, duration, aspectRatio), "utf8")
      filter += `,ass=filename='${ffmpegFilterPath(overlaysAss)}':fontsdir='${ffmpegFilterPath(path.resolve("public/fonts"))}'`
    }
    if (subtitles) {
      const ass = path.join(temporary, "captions.ass")
      await writeFile(
        ass,
        buildAss(
          segments,
          start,
          end,
          subtitleColor,
          captionStyle,
          aspectRatio,
          wordHighlight,
          highlightKeywords,
          addEmojis,
          autoCensor,
        ),
        "utf8",
      )
      filter += `,ass=filename='${ffmpegFilterPath(ass)}':fontsdir='${ffmpegFilterPath(path.resolve("public/fonts"))}'`
    }
    const loadArgs =
      processingMode === "eco" ? ["-threads", "2", "-filter_threads", "2"] : []
    const audioFilter = [
      autoCensor ? censoredAudioFilter(segments, start, end) : "",
      audioEdgeFade && duration > 0.08 ? `afade=t=in:st=0:d=0.025,afade=t=out:st=${(duration - 0.025).toFixed(3)}:d=0.025` : "",
    ].filter(Boolean).join(",")
    const watermarkWidth = Math.max(
      72,
      Math.round((dimensions[0] * 0.115) / 2) * 2,
    )
    const watermarkFilter = `[0:v]${filter}[content];[1:v]scale=${watermarkWidth}:-2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2,2)),34,0)'[mark];[content][mark]overlay=x='if(lt(mod(t,33),11),22,if(lt(mod(t,33),22),W-w-22,W-w-22))':y='if(lt(mod(t,33),11),22,if(lt(mod(t,33),22),22,(H-h)/2))':eval=frame:eof_action=repeat[watermarked]`
    const videoArgs = includeWatermark
      ? [
          "-loop",
          "1",
          "-i",
          watermark,
          "-filter_complex",
          watermarkFilter,
          "-map",
          "[watermarked]",
        ]
      : ["-vf", filter, "-map", "0:v:0"]
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        ...loadArgs,
        "-ss",
        String(start),
        "-i",
        source,
        ...videoArgs,
        "-t",
        String(duration),
        "-map",
        "0:a:0",
        ...(audioFilter ? ["-af", audioFilter] : []),
        "-c:v",
        "libx264",
        "-preset",
        processingMode === "eco" ? "ultrafast" : "fast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        partial,
      ],
      options,
    )
    const probe = JSON.parse(
      await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,codec_name,width,height,duration:format=duration,size",
          "-of",
          "json",
          partial,
        ],
        { signal },
      ),
    )
    const video = probe.streams?.find(
      (stream: { codec_type: string }) => stream.codec_type === "video",
    )
    const audio = probe.streams?.find(
      (stream: { codec_type: string }) => stream.codec_type === "audio",
    )
    const validDuration = (value: unknown) =>
      Number.isFinite(Number(value)) &&
      Math.abs(Number(value) - duration) <= 0.75
    const size = (await stat(partial)).size
    if (
      !video ||
      !audio ||
      video.codec_name !== "h264" ||
      audio.codec_name !== "aac" ||
      video.width !== dimensions[0] ||
      video.height !== dimensions[1] ||
      !validDuration(probe.format?.duration) ||
      !validDuration(video.duration) ||
      !validDuration(audio.duration) ||
      size < 1024 ||
      Number(probe.format?.size) !== size
    )
      throw new Error(
        "Готовый клип не прошёл проверку видео, аудио или длительности.",
      )
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-ss",
        String(Math.min(1, duration / 2)),
        "-i",
        partial,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "3",
        previewPartial,
      ],
      { signal },
    )
    if ((await stat(previewPartial)).size < 100)
      throw new Error("Не удалось создать превью.")
    if (signal?.aborted) throw new Error("Обработка отменена.")
    await rename(previewPartial, preview)
    await rename(partial, final)
    return final
  } catch (error) {
    await Promise.all(
      [partial, previewPartial, preview].map((file) =>
        rm(file, { force: true }),
      ),
    )
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
