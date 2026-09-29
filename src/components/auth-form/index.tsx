"use client"
import { useState, type FormEvent } from "react"
import styles from "./index.module.scss"

export function AuthForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      window.location.href = "/"
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти.")
      setBusy(false)
    }
  }
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href='/' className={styles.logo}>
          <span>✂</span>Clipworks
        </a>
        <h1>{mode === "login" ? "С возвращением" : "Создать аккаунт"}</h1>
        <p>История и настройки сохраняются локально на этом устройстве.</p>
        <form onSubmit={submit}>
          <label>
            Логин
            <input
              name='username'
              autoComplete='username'
              minLength={3}
              maxLength={32}
              required
            />
          </label>
          <label>
            Пароль
            <input
              name='password'
              type='password'
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              required
            />
          </label>
          <button disabled={busy}>
            {busy
              ? "Подождите…"
              : mode === "login"
                ? "Войти"
                : "Зарегистрироваться"}
          </button>
        </form>
        <span className={styles.message} role='alert'>
          {message}
        </span>
        {googleEnabled && (
          <a className={styles.google} href='/api/auth/google'>
            Продолжить через Google
          </a>
        )}
        <button
          className={styles.change}
          type='button'
          onClick={() => {
            setMode((value) => (value === "login" ? "register" : "login"))
            setMessage("")
          }}
        >
          {mode === "login"
            ? "Нет аккаунта? Зарегистрироваться"
            : "Уже есть аккаунт? Войти"}
        </button>
      </section>
    </main>
  )
}
