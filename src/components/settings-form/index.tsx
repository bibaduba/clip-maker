"use client"
import { useEffect, useState, type FormEvent } from "react"
import type { AuthUser } from "@/lib/auth-types"
import { ConfirmDialog } from "@/components/confirm-dialog"
import styles from "./index.module.scss"

type StorageUsage = { readyBytes: number; cacheBytes: number; totalBytes: number; projects: number; cacheFiles: number }
function formatBytes(bytes: number) { if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`; return `${(bytes / 1024 ** 3).toFixed(2)} ГБ` }

export function SettingsForm({ user }: { user: AuthUser }) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [storageMessage, setStorageMessage] = useState("")
  const [cleaning, setCleaning] = useState(false)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  useEffect(() => { fetch('/api/storage', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setUsage(data.usage); if (data.cleaned?.deletedFiles) setStorageMessage(`Автоматически освобождено ${formatBytes(data.cleaned.deletedBytes)}.`) }).catch(error => setStorageMessage(error instanceof Error ? error.message : 'Не удалось рассчитать место.')) }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    const form = new FormData(event.currentTarget)
    const payload = {
      username: form.get("username"),
      theme: form.get("theme"),
      defaultSubtitles: form.get("defaultSubtitles") === "on",
      defaultReframe: form.get("defaultReframe") === "on",
      cacheRetentionDays: Number(form.get("cacheRetentionDays")),
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
    }
    try {
      const response = await fetch("/api/auth/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setMessage("Настройки сохранены.")
      document.documentElement.dataset.theme = data.user.theme
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить настройки.",
      )
    } finally {
      setBusy(false)
    }
  }
  async function cleanup() {
    setCleaning(true); setStorageMessage("")
    try { const response = await fetch('/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cleanup-cache' }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setUsage(data.usage); setStorageMessage(`Освобождено ${formatBytes(data.cleaned.deletedBytes)}. Готовые клипы сохранены.`); setConfirmCleanup(false) }
    catch (error) { setStorageMessage(error instanceof Error ? error.message : 'Не удалось очистить кэш.') }
    finally { setCleaning(false) }
  }
  return (<>
    <form className={styles.form} onSubmit={submit}>
      <section>
        <h2>Профиль</h2>
        <label>
          Логин
          <input
            name='username'
            defaultValue={user.username}
            required
            minLength={3}
            maxLength={32}
          />
        </label>
        <label>
          Текущий пароль
          <input
            name='currentPassword'
            type='password'
            autoComplete='current-password'
            placeholder={
              user.hasPassword
                ? "Нужен для смены пароля"
                : "Пароль ещё не установлен"
            }
          />
        </label>
        <label>
          Новый пароль
          <input
            name='newPassword'
            type='password'
            autoComplete='new-password'
            suppressHydrationWarning
            minLength={8}
            placeholder='Оставьте пустым без изменений'
          />
        </label>
      </section>
      <section>
        <h2>Внешний вид</h2>
        <label>
          Тема
          <select name='theme' defaultValue={user.theme}>
            <option value='system'>Как в системе</option>
            <option value='light'>Светлая</option>
            <option value='dark'>Тёмная</option>
          </select>
        </label>
      </section>
      <section>
        <h2>Обработка по умолчанию</h2>
        <label className={styles.check}>
          <input
            name='defaultSubtitles'
            type='checkbox'
            defaultChecked={user.defaultSubtitles}
          />
          Субтитры
        </label>
        <label className={styles.check}>
          <input
            name='defaultReframe'
            type='checkbox'
            defaultChecked={user.defaultReframe}
          />
          AI-кадрирование
        </label>
      </section>
      <section>
        <h2>Хранилище</h2>
        {usage ? <div className={styles.storage}><div className={styles.storageHeader}><strong>{formatBytes(usage.totalBytes)}</strong><span>{usage.projects} проектов</span></div><div className={styles.storageBar}><i style={{ width: `${usage.totalBytes ? usage.readyBytes / usage.totalBytes * 100 : 0}%` }}/></div><div className={styles.storageLegend}><span><i/>Готовые клипы: {formatBytes(usage.readyBytes)}</span><span><i/>Кэш: {formatBytes(usage.cacheBytes)}</span></div></div> : <p className={styles.storageStatus}>Считаем занятое место…</p>}
        <label>Хранить кэш исходников<select name='cacheRetentionDays' defaultValue={user.cacheRetentionDays}><option value={1}>1 день</option><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={0}>Без автоматической очистки</option></select></label>
        <p className={styles.storageHint}>Кэш включает исходное видео, аудио, расшифровку и данные анализа. После его удаления готовые клипы продолжат работать, но повторная генерация потребует загрузки и распознавания заново.</p>
        <button className={styles.cleanupButton} type='button' disabled={cleaning || !usage?.cacheBytes} onClick={() => setConfirmCleanup(true)}>{cleaning ? 'Очищаем…' : 'Очистить кэш сейчас'}</button>
        <span className={styles.storageStatus} role='status'>{storageMessage}</span>
      </section>
      <div className={styles.actions}>
        <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
        <span role='status'>{message}</span>
      </div>
    </form>
    <ConfirmDialog open={confirmCleanup} title='Очистить кэш проектов?' description='Будут удалены исходные видео, аудио, расшифровки и временные данные завершённых проектов. Готовые клипы и превью останутся на месте.' confirmLabel='Очистить кэш' busy={cleaning} onClose={() => setConfirmCleanup(false)} onConfirm={cleanup}/>
  </>)
}
