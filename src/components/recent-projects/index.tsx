'use client';
import { useEffect, useState } from 'react';
import type { ProjectRecord } from '@/lib/project-types';
import { stageLabels } from '@/lib/project-types';
import { isProjectActive, projectProgress } from '@/lib/project-progress';
import { ConfirmDialog } from '@/components/confirm-dialog';
import styles from './index.module.scss';

export function RecentProjects({ kind = 'clips' }: { kind?: 'clips' | 'montage' }) {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const load = () => fetch(`/api/projects?kind=${kind}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось загрузить проекты.'); if (!active) return; const next = (data.projects ?? []) as ProjectRecord[]; setProjects(next); setError(''); if (next.some((project: ProjectRecord) => isProjectActive(project.status))) timer = setTimeout(load, 3000); }).catch(cause => { if (!active) return; setError(cause instanceof Error ? cause.message : 'Не удалось загрузить проекты.'); setProjects([]); });
    load(); return () => { active = false; clearTimeout(timer); };
  }, [kind]);
  if (projects === null) return <div className={styles.empty}>Загружаем проекты…</div>;
  if (error) return <div className={styles.empty}>{error} Обновите страницу, чтобы попробовать снова.</div>;
  if (!projects.length) return <div className={styles.empty}>Первый проект появится здесь после запуска обработки.</div>;
  const remove = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${pendingDelete.id}`, { method: 'DELETE' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Не удалось удалить проект.'); }
      setProjects(current => current?.filter(project => project.id !== pendingDelete.id) ?? []); setPendingDelete(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить проект.'); setPendingDelete(null); }
    finally { setDeleting(false); }
  };
  return <><div className={styles.cards}>{projects.map(project => <article key={project.id} className={styles.card}>
    <img className={styles.preview} src={project.clips[0] ? `/api/clips/${project.clips[0].id}/preview` : `https://i.ytimg.com/vi/${project.videoId}/hqdefault.jpg`} alt="" loading="lazy"/>
    <a href={`/projects/${project.id}`} aria-label={`Открыть проект ${project.title ?? 'Видео YouTube'}`}><span className={styles.status}>{stageLabels[project.status]}</span>{isProjectActive(project.status) && <span className={styles.cardProgress} aria-hidden="true"><i style={{ width: `${projectProgress[project.status]}%` }}/></span>}<span className={styles.info}><strong>{project.title ?? 'Видео YouTube'}</strong><small>{project.clips.length ? `${project.clips.length} ${project.clips.length === 1 ? 'клип' : project.clips.length < 5 ? 'клипа' : 'клипов'}` : new Date(project.createdAt).toLocaleString('ru-RU')}</small></span></a>
    <button className={styles.delete} type="button" aria-label={`Удалить проект ${project.title ?? 'Видео YouTube'}`} onClick={() => setPendingDelete(project)}>×</button>
  </article>)}</div><ConfirmDialog open={Boolean(pendingDelete)} title="Удалить проект?" description="Проект, исходное видео и все созданные клипы будут удалены без возможности восстановления." busy={deleting} onClose={() => setPendingDelete(null)} onConfirm={remove}/></>;
}
