import { currentUser } from '@/server/auth';
import { listOwnedFavoriteClips } from '@/server/projects';

export const runtime = 'nodejs';

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Требуется вход.' }, { status: 401 });
  return Response.json({ clips: listOwnedFavoriteClips(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
