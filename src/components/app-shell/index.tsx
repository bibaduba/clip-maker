import styles from './index.module.scss';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth';

function ProjectsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.07 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4.6 1.7 1.7 0 0 0 10 3.07V3h4v.08a1.7 1.7 0 0 0 1.04 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.96 1.7 1.7 0 0 0 20.93 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
}

function UploadsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>;
}

function FavoritesIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.4 13A5.1 5.1 0 0 1 11.6 5.8L12 6.2l.4-.4A5.1 5.1 0 0 1 19.6 13L12 20.2Z"/></svg>;
}

function MontageIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M3 9h5M3 15h5M16 4v16M16 9h5M16 15h5M10.5 9 15 12l-4.5 3V9Z"/></svg>;
}

export async function AppShell({ children, active = 'projects' }: { children: React.ReactNode; active?: 'projects' | 'montage' | 'favorites' | 'uploads' | 'settings' }) {
  const user = await currentUser(); if (!user) redirect('/login');
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <a href="/" className={styles.logo} aria-label="Clipworks, главная"><span>✂</span>Clipworks</a>
      <nav className={styles.navigation} aria-label="Основная навигация">
        <a href="/" aria-current={active === 'projects' ? 'page' : undefined}><ProjectsIcon/>Проекты</a>
        <a href="/montage" aria-current={active === 'montage' ? 'page' : undefined}><MontageIcon/>Динамичный монтаж</a>
        <a href="/favorites" aria-current={active === 'favorites' ? 'page' : undefined}><FavoritesIcon/>Избранное</a>
        <a href="/uploads" aria-current={active === 'uploads' ? 'page' : undefined}><UploadsIcon/>Загруженные клипы</a>
        <a href="/settings" aria-current={active === 'settings' ? 'page' : undefined}><SettingsIcon/>Настройки</a>
      </nav>
    </aside>
    <main className={styles.main}>
      <header className={styles.header}><span className={styles.username}>{user.username}</span><a className={styles.avatar} href="/settings" aria-label="Настройки профиля">{user.username.slice(0, 1).toLocaleUpperCase('ru-RU')}</a><form action="/api/auth/logout" method="post"><button type="submit">Выйти</button></form></header>
      {children}
    </main>
  </div>;
}
