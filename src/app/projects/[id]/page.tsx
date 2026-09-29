import { AppShell } from '@/components/app-shell';
import { ProjectDetail } from '@/components/project-detail';
import { currentUser } from '@/server/auth';
import { redirect } from 'next/navigation';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await currentUser()) redirect('/login');
  const { id } = await params;
  return <AppShell><ProjectDetail id={id}/></AppShell>;
}
