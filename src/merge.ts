import type { Txn } from './parser';
import type { Rules } from './storage';

const MATCH_WINDOW = 20 * 60000;
/** Same payment seen by SMS and by email: same amount and direction within 20 minutes. */
function sameAcrossSources(a: Txn, b: Txn) {
  return !a.manual && (a.source ?? 'sms') !== (b.source ?? 'sms') && a.type === b.type
    && Math.abs(a.amount - b.amount) < 0.005 && Math.abs(a.date - b.date) < MATCH_WINDOW;
}

/** Adds new transactions, skipping messages already seen and the same payment reported twice (same ref + amount, or SMS + email). */
export function mergeTxns(existing: Txn[], incoming: Txn[]): { merged: Txn[]; added: number } {
  const seenSms = new Set(existing.map(t => t.smsId).filter(Boolean));
  const seenRef = new Set(existing.filter(t => t.ref).map(t => `${t.ref}|${t.amount}|${t.type}`));
  const out = [...existing];
  let added = 0;
  for (const t of incoming) {
    if (t.smsId && seenSms.has(t.smsId)) continue;
    const refKey = t.ref ? `${t.ref}|${t.amount}|${t.type}` : null;
    if (refKey && seenRef.has(refKey)) continue;
    if (out.some(e => sameAcrossSources(e, t))) continue;
    out.push(t);
    if (t.smsId) seenSms.add(t.smsId);
    if (refKey) seenRef.add(refKey);
    added++;
  }
  out.sort((a, b) => b.date - a.date);
  return { merged: out, added };
}

export function applyRule(t: Txn, rules: Rules): Txn {
  const c = rules[t.merchant.toLowerCase()];
  return c && t.type === 'debit' ? { ...t, category: c, excluded: c === 'Card Bill' ? true : t.excluded } : t;
}
