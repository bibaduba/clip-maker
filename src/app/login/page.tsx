import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/server/auth';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return <AuthForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}/>;
}
