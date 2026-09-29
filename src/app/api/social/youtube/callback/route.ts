import { cookies } from 'next/headers';
import { currentUser } from '@/server/auth';
import { saveYouTubeConnection } from '@/server/social';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const user = await currentUser(); const url = new URL(request.url); const store = await cookies();
  const state = store.get('youtube_oauth_state')?.value; const verifier = store.get('youtube_oauth_verifier')?.value;
  if (!user || !state || !verifier || state !== url.searchParams.get('state') || !url.searchParams.get('code')) return Response.redirect(new URL('/?youtube=failed', request.url));
  try {
    const callback = new URL('/api/social/youtube/callback', request.url).toString();
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: callback, grant_type: 'authorization_code', code_verifier: verifier }) });
    const token = await response.json() as { refresh_token?: string };
    if (!response.ok || !token.refresh_token) throw new Error('Google не вернул refresh token.');
    saveYouTubeConnection(user.id, token.refresh_token);
    const returnTo = store.get('youtube_oauth_return')?.value || '/';
    store.delete('youtube_oauth_state'); store.delete('youtube_oauth_verifier');
    store.delete('youtube_oauth_return');
    const destination = new URL(returnTo, request.url); destination.searchParams.set('youtube', 'connected');
    return Response.redirect(destination);
  } catch { return Response.redirect(new URL('/?youtube=failed', request.url)); }
}
