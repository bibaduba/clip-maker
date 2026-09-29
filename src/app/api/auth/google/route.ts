import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return Response.redirect(new URL('/login?error=google-not-configured', request.url));
  const state = randomBytes(24).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
  const options = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 };
  const store = await cookies(); store.set('google_oauth_state', state, options); store.set('google_oauth_verifier', verifier, options);
  const callback = new URL('/api/auth/google/callback', request.url).toString();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'openid email profile', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account' }).toString();
  return Response.redirect(url);
}
