import { cookies } from 'next/headers';
import { createSession, findOrCreateGoogleUser } from '@/server/auth';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const url = new URL(request.url); const store = await cookies();
  const state = store.get('google_oauth_state')?.value; const verifier = store.get('google_oauth_verifier')?.value;
  if (!state || !verifier || url.searchParams.get('state') !== state || !url.searchParams.get('code')) return Response.redirect(new URL('/login?error=google-state', request.url));
  const clientId = process.env.GOOGLE_CLIENT_ID; const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return Response.redirect(new URL('/login?error=google-not-configured', request.url));
  try {
    const callback = new URL('/api/auth/google/callback', request.url).toString();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: clientId, client_secret: secret, redirect_uri: callback, grant_type: 'authorization_code', code_verifier: verifier }) });
    const token = await tokenResponse.json() as { access_token?: string }; if (!tokenResponse.ok || !token.access_token) throw new Error('token');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string }; if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) throw new Error('profile');
    await createSession(findOrCreateGoogleUser({ sub: profile.sub, email: profile.email, name: profile.name }));
    store.delete('google_oauth_state'); store.delete('google_oauth_verifier');
    return Response.redirect(new URL('/', request.url));
  } catch { return Response.redirect(new URL('/login?error=google-failed', request.url)); }
}
