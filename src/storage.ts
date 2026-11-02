import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Txn } from './parser';
import type { CustomCategory } from './categories';

const K = {
  txns: 'kanakku.txns.v1',
  rules: 'kanakku.rules.v1',
  lastScan: 'kanakku.lastScan.v1',
  cats: 'kanakku.customCats.v1',
};

export type Rules = Record<string, string>; // merchant (lowercase) -> category

export async function loadAll(): Promise<{ txns: Txn[]; rules: Rules; lastScan: number; cats: CustomCategory[] }> {
  const [[, t], [, r], [, l], [, c]] = await AsyncStorage.multiGet([K.txns, K.rules, K.lastScan, K.cats]);
  return {
    txns: t ? JSON.parse(t) : [],
    rules: r ? JSON.parse(r) : {},
    lastScan: l ? Number(l) : 0,
    cats: c ? JSON.parse(c) : [],
  };
}

export const saveCats = (c: CustomCategory[]) => AsyncStorage.setItem(K.cats, JSON.stringify(c));
export const saveTxns = (t: Txn[]) => AsyncStorage.setItem(K.txns, JSON.stringify(t));
export const saveRules = (r: Rules) => AsyncStorage.setItem(K.rules, JSON.stringify(r));
export const saveLastScan = (n: number) => AsyncStorage.setItem(K.lastScan, String(n));

/** Adds new transactions, skipping SMS already seen and the same payment reported twice (same ref + amount). */
export function mergeTxns(existing: Txn[], incoming: Txn[]): { merged: Txn[]; added: number } {
  const seenSms = new Set(existing.map(t => t.smsId).filter(Boolean));
  const seenRef = new Set(existing.filter(t => t.ref).map(t => `${t.ref}|${t.amount}|${t.type}`));
  const out = [...existing];
  let added = 0;
  for (const t of incoming) {
    if (t.smsId && seenSms.has(t.smsId)) continue;
    const refKey = t.ref ? `${t.ref}|${t.amount}|${t.type}` : null;
    if (refKey && seenRef.has(refKey)) continue;
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
