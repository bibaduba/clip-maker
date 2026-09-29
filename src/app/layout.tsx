import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.scss';
export const metadata: Metadata = { title: 'Clipworks', description: 'Create short clips from long YouTube videos' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get('clip_theme')?.value;
  return <html lang="ru" data-theme={theme === 'light' || theme === 'dark' ? theme : undefined}><body>{children}</body></html>;
}
