import type { Txn } from './parser';

export type AccountKind = 'bank' | 'card' | 'cash' | 'wallet';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  bank?: string;      // as shown on entries, e.g. "Federal"
  last4?: string;     // last digits of account / card number
  opening: number;    // balance you entered (card: amount due) ...
  openingAt: number;  // ... and when
  limit?: number;     // credit limit (cards)
  atmToCash?: boolean; // cash wallet: ATM withdrawals go in here and are not counted as spending
}

export const KINDS: Record<AccountKind, { icon: string; label: string }> = {
  bank: { icon: '🏦', label: 'Bank account' },
  card: { icon: '💳', label: 'Credit card' },
  cash: { icon: '💵', label: 'Cash' },
  wallet: { icon: '📱', label: 'Wallet' },
};

const sameBank = (a?: string, b?: string) => !a || !b || a.toLowerCase() === b.toLowerCase();
const digitsMatch = (a: string, b: string) => a.endsWith(b) || b.endsWith(a);

/** Which of your accounts an entry belongs to (explicit choice first, then bank + last digits). */
export function accountFor(t: Txn, accounts: Account[]): Account | undefined {
  if (t.accountId === 'none') return undefined;
  if (t.accountId) return accounts.find(a => a.id === t.accountId);
  if (t.manual && t.mode === 'Cash') return accounts.find(a => a.kind === 'cash');
  if (!t.account) return undefined;
  return accounts.find(a => a.last4 && digitsMatch(a.last4, t.account!) && sameBank(a.bank, t.bank));
}

const NUM = '([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
const CUR = '(?:rs\\.?|inr|₹)\\s*';
const BAL_RE = new RegExp(`(?:avl\\.?|avail(?:able)?|a\\/c|clear|ledger|total)?\\s*bal(?:ance)?\\.?\\s*(?:is|:|-|of)?\\s*${CUR}(-)?\\s*${NUM}`, 'i');
const LIMIT_RE = new RegExp(`(?:avl\\.?|avail(?:able)?)\\s*(?:credit\\s*)?(?:limit|lmt)\\.?\\s*(?:is|:|-)?\\s*${CUR}${NUM}`, 'i');
const num = (s: string) => parseFloat(s.replace(/,/g, ''));

/** Balance or available card limit that the bank stated in the message, if any. */
export function reported(t: Txn): { balance?: number; availLimit?: number } {
  const body = t.body || '';
  const out: { balance?: number; availLimit?: number } = {};
  const l = LIMIT_RE.exec(body);
  if (l) out.availLimit = num(l[1]);
  const b = BAL_RE.exec(body);
  if (b && !/limit/i.test(body.slice(Math.max(0, b.index - 12), b.index + 4))) out.balance = (b[1] ? -1 : 1) * num(b[2]);
  return out;
}

export interface Balance {
  value: number;            // bank/cash/wallet: money in it; card: amount due
  source: 'bank' | 'you';   // where the starting figure came from
  sourceAt: number;         // when that figure was true
  later: number;            // entries added on top of it
  available?: number;       // cards: limit left
  monthIn: number;
  monthOut: number;
  entries: number;
}

/** A card's own "payment received" message (stored as a debit by older versions) reduces what is due. */
export const isCardPayment = (t: Txn) => t.merchant === 'Credit card bill';
/** Direction of money for the account the entry belongs to. */
const direction = (t: Txn): 'in' | 'out' => (t.type === 'credit' || isCardPayment(t) ? 'in' : 'out');

const isAtmIntoCash = (t: Txn, acc: Account) => acc.kind === 'cash' && !!acc.atmToCash && t.mode === 'ATM' && t.type === 'debit';

/**
 * Current balance of one account. Starts from the latest known figure — the balance printed in a bank SMS,
 * or the one you entered, whichever is newer — and adds the entries after it.
 */
export function balanceOf(acc: Account, txns: Txn[], accounts: Account[], monthStart: number, monthEnd: number): Balance {
  const own = txns.filter(t => accountFor(t, accounts)?.id === acc.id);
  const atmIn = acc.kind === 'cash' && acc.atmToCash ? txns.filter(t => isAtmIntoCash(t, acc)) : [];
  const moves = [...own, ...atmIn].sort((a, b) => a.date - b.date);

  // Effect of an entry on this account: + adds money (or, for a card, adds to the amount due)
  const effect = (t: Txn) => {
    if (atmIn.includes(t)) return t.amount;
    const sign = direction(t) === 'in' ? 1 : -1;
    return acc.kind === 'card' ? -sign * t.amount : sign * t.amount;
  };

  let anchor = { value: acc.opening, at: acc.openingAt, source: 'you' as Balance['source'], id: '' };
  let available: number | undefined;
  for (const t of own) {
    if (t.date < anchor.at) continue;
    const r = reported(t);
    if (acc.kind === 'card') {
      if (r.availLimit != null && acc.limit) anchor = { value: acc.limit - r.availLimit, at: t.date, source: 'bank', id: t.id };
    } else if (r.balance != null) {
      anchor = { value: r.balance, at: t.date, source: 'bank', id: t.id };
    }
  }
  let value = anchor.value;
  let later = 0;
  for (const t of moves) {
    if (t.date < anchor.at || t.id === anchor.id) continue;
    if (t.date === anchor.at && anchor.source === 'you') continue;
    value += effect(t);
    later++;
  }
  if (acc.kind === 'card' && acc.limit) available = acc.limit - value;

  let monthIn = 0, monthOut = 0;
  for (const t of moves) {
    if (t.date < monthStart || t.date >= monthEnd) continue;
    const e = effect(t);
    const incoming = acc.kind === 'card' ? e < 0 : e > 0;
    if (incoming) monthIn += Math.abs(e); else monthOut += Math.abs(e);
  }
  return {
    value: Math.round(value * 100) / 100,
    source: anchor.source,
    sourceAt: anchor.at,
    later,
    available,
    monthIn, monthOut,
    entries: moves.length,
  };
}

export interface Suggestion { bank?: string; last4: string; count: number; kind: AccountKind }

/** Bank/card numbers seen in your messages that are not set up as accounts yet. */
export function detectAccounts(txns: Txn[], accounts: Account[]): Suggestion[] {
  const groups = new Map<string, Suggestion & { cardHints: number }>();
  for (const t of txns) {
    if (!t.account || t.manual || accountFor(t, accounts)) continue;
    const key = `${(t.bank || '').toLowerCase()}|${t.account}`;
    const g = groups.get(key) || { bank: t.bank, last4: t.account, count: 0, kind: 'bank' as AccountKind, cardHints: 0 };
    g.count++;
    const own = new RegExp(`credit\\s*card\\s*(?:no\\.?|number|ending(?:\\s*with)?)?\\s*[x*]*\\s*\\d*${t.account}`, 'i');
    if (own.test(t.body || '') || reported(t).availLimit != null) g.cardHints++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ cardHints, ...g }) => ({ ...g, kind: (cardHints > 0 ? 'card' : 'bank') as AccountKind }))
    .sort((a, b) => b.count - a.count);
}

const PAIR_WINDOW = 3 * 3600_000;

/**
 * Money moved between your own accounts (and ATM cash into the cash wallet) is not spending or income:
 * such entries are left out of totals. Entries you changed by hand are never touched.
 */
export function markSelfTransfers(txns: Txn[], accounts: Account[]): Txn[] {
  // 1) undo earlier automatic marks, so changes to accounts are reflected
  let out = txns.map(t => (t.selfTransfer && !t.userEdited
    ? { ...t, excluded: t.preTransfer?.excluded, category: t.preTransfer?.category ?? t.category, selfTransfer: undefined, preTransfer: undefined }
    : t));
  if (!accounts.length) return out.map((t, i) => (t === txns[i] ? t : stripUndef(t)));

  const mark = (t: Txn, category?: string): Txn => ({
    ...t, preTransfer: { excluded: t.excluded, category: t.category }, selfTransfer: true, excluded: true,
    category: category ?? t.category,
  });
  const acc = out.map(t => accountFor(t, accounts));
  const used = new Set<number>();
  const order = out.map((_, i) => i).sort((a, b) => out[a].date - out[b].date);

  for (const i of order) {
    const d = out[i];
    if (direction(d) !== 'out' || !acc[i] || d.userEdited || used.has(i)) continue;
    for (const j of order) {
      const c = out[j];
      if (j === i || used.has(j) || direction(c) !== 'in' || !acc[j] || c.userEdited) continue;
      if (acc[j]!.id === acc[i]!.id || Math.abs(c.amount - d.amount) > 0.005 || Math.abs(c.date - d.date) > PAIR_WINDOW) continue;
      const cat = acc[j]!.kind === 'card' ? 'Card Bill' : 'Transfers';
      out[i] = mark(d, cat); out[j] = mark(c, acc[j]!.kind === 'card' ? 'Card Bill' : undefined);
      used.add(i); used.add(j);
      break;
    }
  }
  const cash = accounts.find(a => a.kind === 'cash' && a.atmToCash);
  if (cash) out = out.map(t => (isAtmIntoCash(t, cash) && !t.userEdited && !t.selfTransfer ? mark(t) : t));
  return out.map((t, i) => (t === txns[i] ? t : stripUndef(t)));
}

function stripUndef(t: Txn): Txn {
  const c: any = { ...t };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return c;
}
