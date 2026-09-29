import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { currentUser } from '@/server/auth';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!await currentUser()) return Response.redirect(new URL('/login', request.url));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return Response.redirect(new URL('/?youtube=not-configured', request.url));
  const state = randomBytes(24).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
  const options = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 };
  const store = await cookies(); store.set('youtube_oauth_state', state, options); store.set('youtube_oauth_verifier', verifier, options);
  const returnTo = new URL(request.url).searchParams.get('returnTo');
  store.set('youtube_oauth_return', returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', options);
  const callback = new URL('/api/social/youtube/callback', request.url).toString();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent' }).toString();
  return Response.redirect(url);
}
