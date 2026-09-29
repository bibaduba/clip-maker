"use client"
import { useRef, useState } from "react"
import styles from "./index.module.scss"

export type ManualCrop = { x: number; y: number; width: number; height: number }
export type TextOverlay = { id: string; text: string; x: number; y: number; fontFamily: "Montserrat" | "Russo One" | "Arial" | "Bahnschrift"; fontSize: number; color: string; backgroundColor: string; backgroundOpacity: number; bold: boolean; start: number; end: number }
export type VisualEditorValue = { manualCrop: ManualCrop | null; textOverlays: TextOverlay[]; duration: number; start: number; aspectRatio: string; cropAspectRatio: string; adhdMode: boolean }

const ratios: Record<string, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function ClipVisualEditor({ clipId, value, onChange }: { clipId: string; value: VisualEditorValue; onChange: (changes: Partial<VisualEditorValue>) => void }) {
  const cropStage = useRef<HTMLDivElement>(null)
  const cropDrag = useRef<{ mode: "move" | "resize"; x: number; y: number; crop: ManualCrop } | null>(null)
  const textStage = useRef<HTMLDivElement>(null)
  const textDrag = useRef<{ id: string; x: number; y: number; left: number; top: number } | null>(null)
  const [sourceAspect, setSourceAspect] = useState(16 / 9)
  const [selectedText, setSelectedText] = useState<string | null>(value.textOverlays[0]?.id ?? null)

  const initialCrop = () => {
    const target = ratios[value.cropAspectRatio] ?? 9 / 16
    return sourceAspect > target
      ? { x: (1 - target / sourceAspect) / 2, y: 0, width: target / sourceAspect, height: 1 }
      : { x: 0, y: (1 - sourceAspect / target) / 2, width: 1, height: sourceAspect / target }
  }
  const moveCrop = (event: React.PointerEvent) => {
    const drag = cropDrag.current; const stage = cropStage.current
    if (!drag || !stage) return
    const bounds = stage.getBoundingClientRect(); const dx = (event.clientX - drag.x) / bounds.width; const dy = (event.clientY - drag.y) / bounds.height
    if (drag.mode === "move") onChange({ manualCrop: { ...drag.crop, x: clamp(drag.crop.x + dx, 0, 1 - drag.crop.width), y: clamp(drag.crop.y + dy, 0, 1 - drag.crop.height) } })
    else {
      const target = ratios[value.cropAspectRatio] ?? 9 / 16
      const width = clamp(drag.crop.width + dx, 0.08, 1 - drag.crop.x)
      const height = width * bounds.width / target / bounds.height
      const safeHeight = Math.min(height, 1 - drag.crop.y)
      const safeWidth = safeHeight * target * bounds.height / bounds.width
      onChange({ manualCrop: { ...drag.crop, width: safeWidth, height: safeHeight } })
    }
  }
  const addText = () => {
    if (value.textOverlays.length >= 8) return
    const id = globalThis.crypto?.randomUUID?.() ?? `text-${Date.now()}`
    const next: TextOverlay = { id, text: "Ваш текст", x: .5, y: .2, fontFamily: "Montserrat", fontSize: 54, color: "#ffffff", backgroundColor: "#000000", backgroundOpacity: .55, bold: true, start: 0, end: value.duration }
    onChange({ textOverlays: [...value.textOverlays, next] }); setSelectedText(id)
  }
  const updateText = (id: string, changes: Partial<TextOverlay>) => onChange({ textOverlays: value.textOverlays.map(item => item.id === id ? { ...item, ...changes } : item) })
  const moveText = (event: React.PointerEvent) => {
    const drag = textDrag.current; const stage = textStage.current
    if (!drag || !stage) return
    const bounds = stage.getBoundingClientRect()
    updateText(drag.id, { x: clamp(drag.left + (event.clientX - drag.x) / bounds.width, .03, .97), y: clamp(drag.top + (event.clientY - drag.y) / bounds.height, .03, .97) })
  }
  const selected = value.textOverlays.find(item => item.id === selectedText) ?? null

  return <div className={styles.visualEditor}>
    <section className={styles.panel}>
      <header><div><b>Свободное кадрирование</b><small>{value.adhdMode ? "Настраивается верхнее основное видео" : "Выберите любую область исходного видео"}</small></div><button type="button" onClick={() => onChange({ manualCrop: value.manualCrop ? null : initialCrop() })}>{value.manualCrop ? "Вернуть AI" : "Настроить вручную"}</button></header>
      <div ref={cropStage} className={styles.cropStage} style={{ aspectRatio: sourceAspect }} onPointerMove={moveCrop} onPointerUp={() => { cropDrag.current = null }} onPointerCancel={() => { cropDrag.current = null }}>
        <video src={`/api/clips/${clipId}/source#t=${value.start}`} muted playsInline preload="metadata" onLoadedMetadata={event => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setSourceAspect(video.videoWidth / video.videoHeight); video.currentTime = value.start }} />
        {value.manualCrop && <div className={styles.cropBox} style={{ left: `${value.manualCrop.x * 100}%`, top: `${value.manualCrop.y * 100}%`, width: `${value.manualCrop.width * 100}%`, height: `${value.manualCrop.height * 100}%` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); cropDrag.current = { mode: "move", x: event.clientX, y: event.clientY, crop: value.manualCrop! } }}><span>Будет видно</span><i onPointerDown={event => { event.stopPropagation(); event.currentTarget.parentElement?.setPointerCapture(event.pointerId); cropDrag.current = { mode: "resize", x: event.clientX, y: event.clientY, crop: value.manualCrop! } }} /></div>}
      </div>
      <p>{value.manualCrop ? "Перетаскивайте рамку; потяните за правый нижний угол, чтобы изменить масштаб." : "Сейчас используется автоматическое кадрирование проекта."}</p>
    </section>

    <section className={styles.panel}>
      <header><div><b>Текст поверх клипа</b><small>До восьми независимых блоков</small></div><button type="button" onClick={addText} disabled={value.textOverlays.length >= 8}>+ Добавить текст</button></header>
      <div ref={textStage} className={styles.textStage} style={{ aspectRatio: ratios[value.aspectRatio] ?? 9 / 16 }} onPointerMove={moveText} onPointerUp={() => { textDrag.current = null }} onPointerCancel={() => { textDrag.current = null }}>
        <img src={`/api/clips/${clipId}/preview`} alt="" />
        {value.textOverlays.map(item => <button key={item.id} type="button" className={styles.textBlock} data-selected={item.id === selectedText || undefined} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, color: item.color, background: item.backgroundOpacity ? `${item.backgroundColor}${Math.round(item.backgroundOpacity * 255).toString(16).padStart(2, "0")}` : "transparent", fontFamily: item.fontFamily, fontWeight: item.bold ? 800 : 400, fontSize: `${clamp(item.fontSize * .34, 10, 34)}px` }} onClick={() => setSelectedText(item.id)} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setSelectedText(item.id); textDrag.current = { id: item.id, x: event.clientX, y: event.clientY, left: item.x, top: item.y } }}>{item.text}</button>)}
      </div>
      {selected ? <div className={styles.textControls}>
        <label className={styles.wide}>Текст<textarea rows={2} maxLength={300} value={selected.text} onChange={event => updateText(selected.id, { text: event.target.value })}/></label>
        <label>Шрифт<select value={selected.fontFamily} onChange={event => updateText(selected.id, { fontFamily: event.target.value as TextOverlay["fontFamily"] })}><option>Montserrat</option><option>Russo One</option><option>Arial</option><option>Bahnschrift</option></select></label>
        <label>Размер <span>{selected.fontSize}</span><input type="range" min="20" max="120" value={selected.fontSize} onChange={event => updateText(selected.id, { fontSize: Number(event.target.value) })}/></label>
        <label>Цвет<input type="color" value={selected.color} onChange={event => updateText(selected.id, { color: event.target.value })}/></label>
        <label>Фон<input type="color" value={selected.backgroundColor} onChange={event => updateText(selected.id, { backgroundColor: event.target.value })}/></label>
        <label>Прозрачность фона <span>{Math.round(selected.backgroundOpacity * 100)}%</span><input type="range" min="0" max="100" value={Math.round(selected.backgroundOpacity * 100)} onChange={event => updateText(selected.id, { backgroundOpacity: Number(event.target.value) / 100 })}/></label>
        <label>Появление, сек.<input type="number" min="0" max={selected.end - .1} step=".1" value={selected.start} onChange={event => updateText(selected.id, { start: clamp(Number(event.target.value), 0, selected.end - .1) })}/></label>
        <label>Исчезновение, сек.<input type="number" min={selected.start + .1} max={value.duration} step=".1" value={selected.end} onChange={event => updateText(selected.id, { end: clamp(Number(event.target.value), selected.start + .1, value.duration) })}/></label>
        <label className={styles.check}><input type="checkbox" checked={selected.bold} onChange={event => updateText(selected.id, { bold: event.target.checked })}/>Жирный</label>
        <button className={styles.remove} type="button" onClick={() => { onChange({ textOverlays: value.textOverlays.filter(item => item.id !== selected.id) }); setSelectedText(null) }}>Удалить блок</button>
      </div> : <p>Добавьте текст и перетащите его в нужное место на кадре.</p>}
    </section>
  </div>
}
