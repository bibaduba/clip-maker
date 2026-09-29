export const PROJECT_STAGES = ['queued', 'metadata', 'downloading', 'transcribing', 'selecting', 'review', 'rendering', 'cancelling', 'cancelled', 'completed', 'failed'] as const;
export type ProjectStage = typeof PROJECT_STAGES[number];
export const PROJECT_KINDS = ['clips', 'montage'] as const;
export type ProjectKind = typeof PROJECT_KINDS[number];
export const PROCESSING_MODES = ['eco', 'fast'] as const;
export type ProcessingMode = typeof PROCESSING_MODES[number];
export const ASPECT_RATIOS = ['9:16', '1:1', '4:5', '16:9'] as const;
export type AspectRatio = typeof ASPECT_RATIOS[number];
export const CLIP_LENGTHS = ['short', 'medium', 'long'] as const;
export type ClipLength = typeof CLIP_LENGTHS[number];
export const CAPTION_STYLES = ['default', 'modern', 'bouncy', 'mrbeast', 'business'] as const;
export type CaptionStyle = typeof CAPTION_STYLES[number];
export const FIT_BACKGROUNDS = ['black', 'blur'] as const;
export type FitBackground = typeof FIT_BACKGROUNDS[number];
export const ADHD_MAIN_POSITIONS = ['left', 'center', 'right'] as const;
export type AdhdMainPosition = typeof ADHD_MAIN_POSITIONS[number];
export const clipLengthRanges: Record<ClipLength, { min: number; max: number }> = { short: { min: 20, max: 30 }, medium: { min: 30, max: 60 }, long: { min: 60, max: 90 } };

export interface ProjectClip {
  id: string;
  projectId: string;
  title: string;
  reason: string;
  queryMatch: number | null;
  viralPotential: number | null;
  hookScore: number | null;
  completenessScore: number | null;
  valueScore: number | null;
  start: number;
  end: number;
  renderedDuration?: number | null;
  subtitles: boolean;
  sizeBytes: number | null;
  createdAt: string;
  brollSources: Array<{ provider: 'pexels'; pageUrl: string; creator: string; creatorUrl: string; license: 'Pexels License' }>;
  brollError: string | null;
  seriesKey: string | null;
  seriesPart: number | null;
  seriesTotal: number | null;
  favorite: boolean;
  notInteresting: boolean;
}

export interface ProjectRecord {
  id: string;
  kind: ProjectKind;
  videoId: string;
  sourceUrl: string;
  title: string | null;
  status: ProjectStage;
  subtitles: boolean;
  subtitleColor: string;
  requestedClips: number;
  processingMode: ProcessingMode;
  autoReframe: boolean;
  aspectRatio: AspectRatio;
  clipLength: ClipLength;
  captionStyle: CaptionStyle;
  wordHighlight: boolean;
  highlightKeywords: boolean;
  addEmojis: boolean;
  autoCensor: boolean;
  clipPrompt: string | null;
  fitBackground: FitBackground;
  addBroll: boolean;
  adhdMode: boolean;
  adhdGameplay: string | null;
  adhdMainPosition: AdhdMainPosition;
  sourceDuration: number | null;
  analyzedDuration: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  clips: ProjectClip[];
}

export const stageLabels: Record<ProjectStage, string> = {
  queued: 'В очереди', metadata: 'Проверяем видео', downloading: 'Загружаем видео', transcribing: 'Распознаём речь', selecting: 'Выбираем моменты', review: 'Моменты на проверке', rendering: 'Монтируем клипы', cancelling: 'Останавливаем', cancelled: 'Отменено', completed: 'Готово', failed: 'Ошибка',
};
