export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  theme: 'system' | 'light' | 'dark';
  defaultMode: 'eco' | 'fast';
  defaultSubtitles: boolean;
  defaultReframe: boolean;
  cacheRetentionDays: number;
  hasPassword: boolean;
}
