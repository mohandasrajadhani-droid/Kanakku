import { parseEmail, RawEmail, Txn } from './parser';
import { htmlToText } from './mailtext';
import { ensureScope, googleFetch, SCOPES, signOutGoogle } from './google';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MESSAGES = 400;

/** Opens the Google account picker and asks for read-only Gmail access. Returns the email, or null if cancelled. */
export const connectGmail = () => ensureScope(SCOPES.gmail);

/** Stops email reading. Google is fully signed out only when Drive backup is not using it. */
export async function disconnectGmail(keepGoogle: boolean) {
  if (!keepGoogle) await signOutGoogle();
}

async function api(path: string): Promise<any> {
  const res = await googleFetch(`${API}/${path}`, {}, 'Gmail');
  return res.json();
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
    const days = Math.max(1, Math.ceil((Date.now() - sinceMs) / 86400000));
  const q = `newer_than:${days}d -category:promotions -category:social -in:sent `
    + '{debited credited spent "transaction alert" "has been debited" "has been credited" "UPI transaction" "card ending" "account ending"}';

  const ids: string[] = [];
  let pageToken = '';
  do {
    const r = await api(`messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const m of r.messages || []) if (!seen.has(`mail-${m.id}`)) ids.push(m.id);
    pageToken = r.nextPageToken || '';
  } while (pageToken && ids.length < MAX_MESSAGES);

  const out: Txn[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(id => api(`messages/${id}?format=full`).catch(() => null)));
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
