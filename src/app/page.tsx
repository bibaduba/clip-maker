import { AppShell } from "@/components/app-shell"
import { ProjectForm } from "@/components/project-form"
import { RecentProjects } from "@/components/recent-projects"
import styles from "./page.module.scss"
import { currentUser } from "@/server/auth"
import { redirect } from "next/navigation"
import { listGameplayVideos } from "@/server/gameplay"

function FeatureIcon({ type }: { type: "cut" | "captions" | "reframe" }) {
  if (type === "cut")
    return (
      <svg viewBox='0 0 24 24'>
        <circle cx='6' cy='6' r='3' />
        <circle cx='6' cy='18' r='3' />
        <path d='m8.5 7.5 10 10M8.5 16.5l10-10' />
      </svg>
    )
  if (type === "captions")
    return (
      <svg viewBox='0 0 24 24'>
        <rect x='3' y='5' width='18' height='14' rx='3' />
        <path d='M7 10h4M7 14h3M13 10h4M12 14h5' />
      </svg>
    )
  return (
    <svg viewBox='0 0 24 24'>
      <path d='M7 3v12a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12' />
      <path d='m4 4 4 4M16 16l4 4' />
    </svg>
  )
}

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect("/login")
  const gameplayVideos = await listGameplayVideos()
  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <span className={`${styles.shape} ${styles.dot}`} />
          <span className={`${styles.shape} ${styles.triangle}`} />
          <span className={`${styles.shape} ${styles.arc}`} />
          <h1>С возвращением, {user.username}.</h1>
          <p>Вставьте ссылку на длинное видео — мы найдём лучшие моменты.</p>
          <ProjectForm
            defaultSubtitles={user.defaultSubtitles}
            defaultReframe={user.defaultReframe}
            brollAvailable={Boolean(process.env.KIMI_API_KEY && process.env.PEXELS_API_KEY)}
            gameplayVideos={gameplayVideos}
          />
        </section>
        <section className={styles.projects}>
          <h2>Ваши проекты</h2>
          <p>Здесь появятся последние обработки.</p>
          <RecentProjects />
        </section>
      </div>
    </AppShell>
  )
}
