import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  drive: 'https://www.googleapis.com/auth/drive.appdata', // private app folder only; cannot see your other Drive files
};

let configured = false;
function setup() {
  if (!configured) { GoogleSignin.configure({}); configured = true; }
}

export function explain(e: any): Error {
  const code = String(e?.code ?? '');
  if (code === '10' || /DEVELOPER_ERROR/i.test(String(e?.message))) {
    return new Error('Google sign-in is not set up for this app yet (Android client with package com.mohandas.kanakku and the SHA-1 in the README).');
  }
  return e instanceof Error ? e : new Error(String(e?.message ?? e));
}

/** Signs in if needed and makes sure the given permission is granted. Returns the account email, or null if cancelled. */
export async function ensureScope(scope: string): Promise<string | null> {
  setup();
  try {
    await GoogleSignin.hasPlayServices();
    let user = GoogleSignin.getCurrentUser();
    if (!user) {
      const silent = await GoogleSignin.signInSilently();
      if (silent.type === 'success') user = silent.data;
    }
    if (!user) {
      const r = await GoogleSignin.signIn();
      if (!isSuccessResponse(r)) return null;
      user = r.data;
    }
    if (!user.scopes?.includes(scope)) {
      const more = await GoogleSignin.addScopes({ scopes: [scope] });
      if (!more || !isSuccessResponse(more)) return null;
      user = more.data;
    }
    return user.user.email;
  } catch (e) { throw explain(e); }
}

/** Access token for API calls, signing in silently. */
export async function accessToken(): Promise<string> {
  setup();
  try {
    const r = await GoogleSignin.signInSilently();
    if (r.type !== 'success') throw new Error('Google sign-in has expired. Connect again from the Overview screen.');
    return (await GoogleSignin.getTokens()).accessToken;
  } catch (e) { throw explain(e); }
}

/** fetch() with the Google token; refreshes the token once on 401. */
export async function googleFetch(url: string, init: RequestInit = {}, label = 'Google'): Promise<Response> {
  let tok = await accessToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${tok}` } });
    if (res.status === 401 && attempt === 0) {
      await GoogleSignin.clearCachedAccessToken(tok);
      tok = await accessToken();
      continue;
    }
    if (res.status === 403) {
      const body = await res.text();
      if (/has not been used|is disabled|SERVICE_DISABLED/i.test(body)) {
        throw new Error(`${label} is not switched on for the Kanakku Google project yet.`);
      }
      throw new Error(`${label} refused the request (403).`);
    }
    if (!res.ok) throw new Error(`${label} error ${res.status}`);
    return res;
  }
  throw new Error(`${label} sign-in failed`);
}

/** Fully disconnects Google (both Gmail reading and Drive backup). */
export async function signOutGoogle() {
  setup();
  try { await GoogleSignin.revokeAccess(); } catch { /* already revoked */ }
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
}
