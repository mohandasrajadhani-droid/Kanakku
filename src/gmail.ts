import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { parseEmail, RawEmail, Txn } from './parser';
import { htmlToText } from './mailtext';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MESSAGES = 400;

let configured = false;
function setup() {
  if (!configured) { GoogleSignin.configure({ scopes: [SCOPE] }); configured = true; }
}

function explain(e: any): Error {
  const code = String(e?.code ?? '');
  if (code === '10' || /DEVELOPER_ERROR/i.test(String(e?.message))) {
    return new Error('Google sign-in is not set up for this app yet. Finish the Google Cloud steps (Android client with package com.mohandas.kanakku and the SHA-1 in the README), then try again.');
  }
  return e instanceof Error ? e : new Error(String(e?.message ?? e));
}

/** Opens the Google account picker and asks for read-only Gmail access. Returns the email, or null if cancelled. */
export async function connectGmail(): Promise<string | null> {
  setup();
  try {
    await GoogleSignin.hasPlayServices();
    const r = await GoogleSignin.signIn();
    if (!isSuccessResponse(r)) return null;
    if (!r.data.scopes?.includes(SCOPE)) {
      const more = await GoogleSignin.addScopes({ scopes: [SCOPE] });
      if (!more || !isSuccessResponse(more)) return null;
    }
    return r.data.user.email;
  } catch (e) { throw explain(e); }
}

export async function disconnectGmail() {
  setup();
  try { await GoogleSignin.revokeAccess(); } catch { /* already revoked */ }
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
}

async function token(): Promise<string> {
  setup();
  try {
    const r = await GoogleSignin.signInSilently();
    if (r.type !== 'success') throw new Error('Gmail sign-in has expired. Tap “Connect Gmail” again.');
    return (await GoogleSignin.getTokens()).accessToken;
  } catch (e) { throw explain(e); }
}

async function api(path: string, tok: { v: string }): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${tok.v}` } });
    if (res.status === 401 && attempt === 0) {
      await GoogleSignin.clearCachedAccessToken(tok.v);
      tok.v = await token();
      continue;
    }
    if (!res.ok) throw new Error(`Gmail error ${res.status}`);
    return res.json();
  }
}

// ---------- decoding ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64urlToUtf8(data: string): string {
  const s = data.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

function bodyText(payload: any): string {
  let plain = '', html = '';
  const walk = (p: any) => {
    if (!p) return;
    if (p.body?.data) {
      if (p.mimeType === 'text/plain' && !plain) plain = b64urlToUtf8(p.body.data);
      else if (p.mimeType === 'text/html' && !html) html = b64urlToUtf8(p.body.data);
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return plain.trim().length > 40 ? plain : htmlToText(html || plain);
}

const header = (payload: any, name: string) =>
  (payload?.headers || []).find((h: any) => h.name.toLowerCase() === name)?.value || '';

/** Reads bank alert emails since `sinceMs` and returns the transactions found. Skips message ids already recorded. */
export async function fetchBankEmails(sinceMs: number, seen: Set<string>): Promise<Txn[]> {
  const tok = { v: await token() };
  const days = Math.max(1, Math.ceil((Date.now() - sinceMs) / 86400000));
  const q = `newer_than:${days}d -category:promotions -category:social -in:sent `
    + '{debited credited spent "transaction alert" "has been debited" "has been credited" "UPI transaction" "card ending" "account ending"}';

  const ids: string[] = [];
  let pageToken = '';
  do {
    const r = await api(`messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`, tok);
    for (const m of r.messages || []) if (!seen.has(`mail-${m.id}`)) ids.push(m.id);
    pageToken = r.nextPageToken || '';
  } while (pageToken && ids.length < MAX_MESSAGES);

  const out: Txn[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(id => api(`messages/${id}?format=full`, tok).catch(() => null)));
    for (const m of batch) {
      if (!m) continue;
      const mail: RawEmail = {
        id: m.id, from: header(m.payload, 'from'), subject: header(m.payload, 'subject'),
        text: bodyText(m.payload), date: Number(m.internalDate) || Date.now(),
      };
      const t = parseEmail(mail);
      if (t && t.date >= sinceMs) out.push(t);
    }
  }
  return out;
}
