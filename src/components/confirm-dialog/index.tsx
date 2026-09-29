'use client';
import { useEffect } from 'react';
import styles from './index.module.scss';

export function ConfirmDialog({ open, title, description, confirmLabel = 'Удалить', busy = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, busy, onClose]);
  if (!open) return null;
  return <div className={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div className={styles.icon}>!</div>
      <h2 id="confirm-title">{title}</h2>
      <p id="confirm-description">{description}</p>
      <div className={styles.actions}>
        <button type="button" onClick={onClose} disabled={busy}>Отмена</button>
        <button type="button" className={styles.danger} onClick={onConfirm} disabled={busy} autoFocus>{busy ? 'Удаляем…' : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
