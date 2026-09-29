import type { ProjectStage } from './project-types';

export const projectProgress: Record<ProjectStage, number> = {
  queued: 5,
  metadata: 12,
  downloading: 30,
  transcribing: 52,
  selecting: 72,
  review: 80,
  rendering: 90,
  cancelling: 96,
  cancelled: 0,
  completed: 100,
  failed: 0,
};

export function isProjectActive(status: ProjectStage) {
  return !['completed', 'failed', 'cancelled', 'review'].includes(status);
}
