import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Txn } from './parser';
export { mergeTxns, applyRule } from './merge';
import type { CustomCategory } from './categories';

const K = {
  txns: 'kanakku.txns.v1',
  rules: 'kanakku.rules.v1',
  lastScan: 'kanakku.lastScan.v1',
  cats: 'kanakku.customCats.v1',
  mail: 'kanakku.mail.v1',
};

export interface MailState { account: string | null; lastScan: number }
export async function loadMail(): Promise<MailState> {
  const v = await AsyncStorage.getItem(K.mail);
  return v ? JSON.parse(v) : { account: null, lastScan: 0 };
}
export const saveMail = (m: MailState) => AsyncStorage.setItem(K.mail, JSON.stringify(m));

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
