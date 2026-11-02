import { categorize, EXCLUDED_BY_DEFAULT } from './categories';

export type TxnType = 'debit' | 'credit';
export type Mode = 'UPI' | 'Card' | 'ATM' | 'NetBanking' | 'Cash' | 'Other';

export interface Txn {
  id: string;
  smsId?: string;
  date: number;
  amount: number;
  type: TxnType;
  merchant: string;
  mode: Mode;
  bank?: string;
  account?: string;
  ref?: string;
  category: string;
  excluded?: boolean;
  manual?: boolean;
  body?: string;
  source?: 'sms' | 'email';
}

export interface RawSms {
  _id: string | number;
  address?: string;
  body?: string;
  date: number | string;
}

const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const BARE_AMOUNT_RE = /\b(?:debited|credited)\s+(?:by|with|for)\s+(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const IGNORE_RE = /\b(otp|one[\s-]?time password|verification code|is requested|has requested|requested (?:rs|inr|money|payment)|collect request|will be (?:debited|deducted)|is due|due (?:on|date|by)|minimum (?:amount )?due|declined|failed|unsuccessful|insufficient|pre-?approved|apply now|congratulations)\b/i;
// Emails carry "never share your OTP" style footers, so only clear non-transaction phrases are skipped.
const EMAIL_IGNORE_RE = /\b(is your otp|otp is|one[\s-]?time password (?:is|for)|has requested|collect request|will be (?:debited|deducted)|minimum (?:amount )?due|payment due|total amount due|declined|failed|unsuccessful|insufficient|pre-?approved|apply now)\b/i;
const DEBIT_RE = /\b(debited|debit of|spent|sent|paid|withdrawn|withdrawal|purchased?|transferred|deducted|txn of|transaction of)\b/i;
const CREDIT_RE = /\b(credited|received|deposited|refund(?:ed)?|reversed|reversal)\b/i;
const CONTEXT_RE = /(a\/c|\bac\b|\bacct\b|account|\bcard\b|\bupi\b|\bvpa\b|\bbank\b|wallet|\bneft\b|\bimps\b|\brtgs\b|\batm\b)/i;
const CARD_BILL_RE = /credit\s*card/i;
const CARD_BILL_PAY_RE = /\b(payment|paid)\b[\s\S]{0,80}?\b(received|credited|towards)\b/i;

const STOP = "(?=\\s+(?:on|ref|refno|via|using|upi|for|at|from|dated|avl|txn|is|has|thru|through|not)\\b|[.(,;:\\n]|\\s+-|\\s*$)";
const NAME = "([A-Za-z0-9][A-Za-z0-9 &'_@/\\-]{1,40}?)";
const VPA = "([\\w.\\-]+@[a-zA-Z]+)";

const UPI_PATH = `\\bUPI\\/P2[AM]\\/\\d{6,}\\/${NAME}(?=\\/|\\s*$|[.,;]|\\s+(?:not|avl|available|bal)\\b)`;
const DEBIT_PATTERNS = [
  UPI_PATH,
  `\\bto\\s+(?:vpa\\s+)?${VPA}`,
  `\\bvpa\\s+${VPA}`,
  `\\bto\\s+${NAME}${STOP}`,
  `;\\s*${NAME}\\s+credited`,
  `\\bat\\s+${NAME}${STOP}`,
  `\\binfo[:\\s-]+${NAME}${STOP}`,
];
const CREDIT_PATTERNS = [
  UPI_PATH,
  `\\b(?:from|by)\\s+(?:vpa\\s+)?${VPA}`,
  `\\bvpa\\s+${VPA}`,
  `\\bfrom\\s+${NAME}${STOP}`,
  `\\bby\\s+${NAME}${STOP}`,
  `\\binfo[:\\s-]+${NAME}${STOP}`,
];
const REJECT_NAME = /^(a\/c|ac|acct|account|your|you|the|beneficiary|card|bank|rs|inr|on|a|neft|imps|rtgs|upi|ref|mob|mobile|link|transfer|txn)\b/i;

const BANKS: [RegExp, string][] = [
  [/SBI/, 'SBI'], [/HDFC/, 'HDFC'], [/ICICI/, 'ICICI'], [/AXIS/, 'Axis'], [/KOTAK|KMBL/, 'Kotak'],
  [/FED/, 'Federal'], [/CAN/, 'Canara'], [/SIB/, 'South Indian'], [/KVB/, 'KVB'], [/BOB|BARODA/, 'Bank of Baroda'],
  [/PNB/, 'PNB'], [/UBI|UNION/, 'Union'], [/IDFC/, 'IDFC First'], [/INDUS|IIB/, 'IndusInd'], [/YES/, 'Yes Bank'],
  [/CSB/, 'CSB'], [/ESAF/, 'ESAF'], [/KGB|KERALA/, 'Kerala Gramin'], [/PAYTM|PYTM/, 'Paytm'], [/AIRTEL|ARTL/, 'Airtel'],
  [/SOUTHINDIAN/, 'South Indian'], [/IOB/, 'IOB'], [/INDBNK|INDIAN/, 'Indian Bank'], [/BOI/, 'Bank of India'], [/CBI|CENT/, 'Central Bank'], [/AUBANK/, 'AU'],
];

function findAmount(body: string): number | null {
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 20), m.index);
    if (/\b(bal|balance|limit|avl|available)\b[^.]{0,10}$/i.test(before)) continue;
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v > 0) return v;
  }
  const b = BARE_AMOUNT_RE.exec(body);
  if (b) {
    const v = parseFloat(b[1].replace(/,/g, ''));
    if (v > 0) return v;
  }
  return null;
}

function detectType(body: string): TxnType | null {
  const d = body.search(DEBIT_RE);
  const c = body.search(CREDIT_RE);
  if (d < 0 && c < 0) return null;
  if (d < 0) return 'credit';
  if (c < 0) return 'debit';
  return d < c ? 'debit' : 'credit';
}

function detectMode(body: string): Mode {
  if (/\batm\b|withdrawn|withdrawal/i.test(body)) return 'ATM';
  if (/\bupi\b|\bvpa\b|@[a-z]{2,}\b/i.test(body)) return 'UPI';
  if (/\bcard\b/i.test(body)) return 'Card';
  if (/\b(neft|imps|rtgs|net ?banking)\b/i.test(body)) return 'NetBanking';
  return 'Other';
}

function extractAccount(body: string): string | undefined {
  const m = /(?:a\/c|\bac\b|\bacct\b|account|\bcard\b)\s*(?:no\.?|number|ending(?: with)?)?\s*[:\-]?\s*[x*.]*\s*(\d{3,6})\b/i.exec(body);
  return m ? m[1].slice(-4) : undefined;
}

function extractRef(body: string): string | undefined {
  const p = /\bUPI\/P2[AM]\/(\d{9,})/i.exec(body);
  if (p) return p[1];
  const re = /(?:upi\s*ref(?:\s*no)?|ref(?:erence)?\s*(?:no|number|id)?|refno|utr|rrn|txn\s*id|upi)[\s.:#-]*(?:is\s+)?([A-Za-z0-9]{6,22})/gi;
  for (const m of body.matchAll(re)) if (/\d{6,}/.test(m[1])) return m[1];
  return undefined;
}

export function bankFromSender(address: string): string | undefined {
  const parts = address.toUpperCase().split('-').filter(p => /[A-Z]/.test(p) && p.length >= 3);
  const code = parts.sort((a, b) => b.length - a.length)[0];
  if (!code) return undefined;
  for (const [re, name] of BANKS) if (re.test(code)) return name;
  return code;
}

function prettify(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (s.includes('@')) {
    const [local, handle] = s.split('@');
    if (/^(paytmqr|bharatpe|q\d|gpay-|mab\.|upiqr)/i.test(local)) return `QR merchant (@${handle.toLowerCase()})`;
    if (!/[a-z]/i.test(local) || /\d{5,}/.test(local)) return s.toLowerCase();
    s = local.replace(/[._-]+/g, ' ');
  }
  return s
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(Ltd|Pvt|Llp)\b\.?/g, m => m.toUpperCase().replace('LTD', 'Ltd').replace('PVT', 'Pvt').replace('LLP', 'LLP'))
    .trim();
}

function extractMerchant(body: string, type: TxnType): string | null {
  const patterns = type === 'debit' ? DEBIT_PATTERNS : CREDIT_PATTERNS;
  for (const p of patterns) {
    const re = new RegExp(p, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const cand = (m[1] || '').trim();
      if (cand.length < 2) continue;
      if (REJECT_NAME.test(cand)) continue;
      if (/^[x*\d\s.\-/]+$/i.test(cand) && !cand.includes('@')) continue;
      return prettify(cand);
    }
  }
  return null;
}

function fallbackName(type: TxnType, mode: Mode): string {
  if (type === 'credit') return mode === 'UPI' ? 'UPI credit' : 'Bank credit';
  switch (mode) {
    case 'UPI': return 'UPI payment';
    case 'Card': return 'Card purchase';
    case 'ATM': return 'ATM withdrawal';
    case 'NetBanking': return 'Bank transfer';
    default: return 'Debit';
  }
}

interface CoreOpts { key: string; date: number; bank?: string; ignore: RegExp; source: 'sms' | 'email' }

function parseCore(body: string, o: CoreOpts): Txn | null {
  const account = extractAccount(body);
  const ref = extractRef(body);
  const base = { id: o.source === 'sms' ? `sms-${o.key}` : o.key, smsId: o.key, date: o.date, bank: o.bank, account, ref, body, source: o.source };

  // A credit-card bill payment duplicates the individual card spends already recorded.
  if (CARD_BILL_RE.test(body) && CARD_BILL_PAY_RE.test(body)) {
    const amount = findAmount(body);
    if (!amount) return null;
    return { ...base, amount, type: 'debit', merchant: 'Credit card bill', mode: 'Card', category: 'Card Bill', excluded: true };
  }

  if (o.ignore.test(body)) return null;
  if (!CONTEXT_RE.test(body)) return null;
  const amount = findAmount(body);
  const type = detectType(body);
  if (!amount || !type) return null;

  const mode = detectMode(body);
  const merchant = extractMerchant(body, type) || fallbackName(type, mode);
  const category = categorize(merchant, body, type, mode);
  return { ...base, amount, type, merchant, mode, category, excluded: EXCLUDED_BY_DEFAULT.has(category) || undefined };
}

/** Turns one SMS into a transaction, or null if it isn't a completed bank/UPI transaction. */
export function parseSms(sms: RawSms): Txn | null {
  const body = (sms.body || '').replace(/\s+/g, ' ').trim();
  const address = (sms.address || '').trim();
  if (body.length < 20) return null;
  // Bank alerts come from alphanumeric senders (VM-SBIUPI), not personal phone numbers.
  if (/^\+?\d{7,}$/.test(address.replace(/\s/g, ''))) return null;
  return parseCore(body, {
    key: String(sms._id), date: Number(sms.date) || Date.now(), bank: bankFromSender(address), ignore: IGNORE_RE, source: 'sms',
  });
}

export interface RawEmail { id: string; from: string; subject: string; text: string; date: number }

export function bankFromEmail(from: string): string | undefined {
  const domain = (/@([\w.-]+)/.exec(from)?.[1] || '').toUpperCase().replace(/\.(COM|NET|IN|CO|ORG|BANK)\b/g, '');
  const label = domain.split('.').filter(p => p !== 'ALERTS' && p !== 'ALERT' && p !== 'MAIL').join('');
  if (!label) return undefined;
  for (const [re, name] of BANKS) if (re.test(label)) return name;
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** Picks the part of a long alert email that describes the transaction. */
function emailSnippet(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');
  const re = new RegExp(AMOUNT_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const win = t.slice(Math.max(0, m.index - 160), m.index + 260);
    if (DEBIT_RE.test(win) || CREDIT_RE.test(win)) return win.trim();
  }
  return null;
}

/** Turns one bank alert email into a transaction, or null. */
export function parseEmail(mail: RawEmail): Txn | null {
  if (/\b(statement|newsletter|offer|cashback offer|e-?mandate registration)\b/i.test(mail.subject) && !/\b(debited|credited|spent)\b/i.test(mail.subject)) return null;
  const snippet = emailSnippet(`${mail.subject}. ${mail.text}`);
  if (!snippet) return null;
  return parseCore(snippet, { key: `mail-${mail.id}`, date: mail.date, bank: bankFromEmail(mail.from), ignore: EMAIL_IGNORE_RE, source: 'email' });
}
