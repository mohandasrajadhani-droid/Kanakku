import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import type { Txn } from './parser';
import type { CustomCategory } from './categories';
import { diffTxns } from './storeDiff';
import type { Snapshot } from './backupFormat';
import type { Account, BalanceAlert } from './accounts';
export { mergeTxns, applyRule } from './merge';

export type Rules = Record<string, string>; // merchant (lowercase) -> category
export interface MailState { account: string | null; lastScan: number }
export interface BackupState { enabled: boolean; account: string | null; lastBackup: number }

// One row per transaction in an on-phone SQLite database (no size limit like the old single-block storage).
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let saved = new Map<string, string>(); // id -> JSON as last written
let queue: Promise<unknown> = Promise.resolve();

/** Runs writes one after another so overlapping saves never interleave. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job, job);
  queue = p.catch(() => undefined);
  return p;
}

function db() {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open() {
  const d = await SQLite.openDatabaseAsync('kanakku.db');
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS txns (id TEXT PRIMARY KEY NOT NULL, date INTEGER NOT NULL, sms_id TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS txns_date ON txns(date);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
  await migrateFromOldStorage(d);
  return d;
}

const OLD = {
  txns: 'kanakku.txns.v1', rules: 'kanakku.rules.v1', lastScan: 'kanakku.lastScan.v1',
  cats: 'kanakku.customCats.v1', mail: 'kanakku.mail.v1',
};

/** One-time move of data saved by earlier versions of the app. */
async function migrateFromOldStorage(d: SQLite.SQLiteDatabase) {
  const done = await d.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'migrated.v1');
  if (done) return;
  const pairs = await AsyncStorage.multiGet(Object.values(OLD));
  const old = Object.fromEntries(pairs) as Record<string, string | null>;
  const txns: Txn[] = old[OLD.txns] ? JSON.parse(old[OLD.txns]!) : [];
  await d.withExclusiveTransactionAsync(async tx => {
    const ins = await tx.prepareAsync('INSERT OR REPLACE INTO txns (id, date, sms_id, json) VALUES (?, ?, ?, ?)');
    try {
      for (const t of txns) await ins.executeAsync(t.id, t.date, t.smsId ?? null, JSON.stringify(t));
    } finally { await ins.finalizeAsync(); }
    const kv = async (k: string, v: string | null) => { if (v != null) await tx.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', k, v); };
    await kv('rules', old[OLD.rules]);
    await kv('lastScan', old[OLD.lastScan]);
    await kv('cats', old[OLD.cats]);
    await kv('mail', old[OLD.mail]);
    await tx.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', 'migrated.v1', String(Date.now()));
  });
  // Old copy is removed only after the move has been committed.
  await AsyncStorage.multiRemove(Object.values(OLD));
}

async function getKv<T>(key: string, fallback: T): Promise<T> {
  const r = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
function setKv(key: string, value: unknown) {
  return serial(async () => { await (await db()).runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, JSON.stringify(value)); });
}

export async function loadAll(): Promise<{ txns: Txn[]; rules: Rules; lastScan: number; cats: CustomCategory[] }> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: string; json: string }>('SELECT id, json FROM txns ORDER BY date DESC');
  saved = new Map(rows.map(r => [r.id, r.json]));
  const txns = rows.map(r => JSON.parse(r.json) as Txn);
  return {
    txns,
    rules: await getKv<Rules>('rules', {}),
    lastScan: Number(await getKv<number>('lastScan', 0)) || 0,
    cats: await getKv<CustomCategory[]>('cats', []),
  };
}

/** Saves the full list, writing only the transactions that changed. */
export function saveTxns(next: Txn[]) {
  return serial(async () => {
    const { upserts, deletes, cache } = diffTxns(saved, next);
    if (!upserts.length && !deletes.length) return;
    const d = await db();
    await d.withExclusiveTransactionAsync(async tx => {
      if (upserts.length) {
        const st = await tx.prepareAsync('INSERT OR REPLACE INTO txns (id, date, sms_id, json) VALUES (?, ?, ?, ?)');
        try { for (const r of upserts) await st.executeAsync(r.id, r.date, r.smsId, r.json); } finally { await st.finalizeAsync(); }
      }
      if (deletes.length) {
        const st = await tx.prepareAsync('DELETE FROM txns WHERE id = ?');
        try { for (const id of deletes) await st.executeAsync(id); } finally { await st.finalizeAsync(); }
      }
    });
    saved = cache;
  });
}

export const saveRules = (r: Rules) => setKv('rules', r);
export const saveLastScan = (n: number) => setKv('lastScan', n);
export const saveCats = (c: CustomCategory[]) => setKv('cats', c);
export const loadMail = () => getKv<MailState>('mail', { account: null, lastScan: 0 });
export const saveMail = (m: MailState) => setKv('mail', m);
export const loadBackupState = () => getKv<BackupState>('backup', { enabled: false, account: null, lastBackup: 0 });
export const saveBackupState = (b: BackupState) => setKv('backup', b);
export const loadAccounts = () => getKv<Account[]>('accounts', []);
export const loadBalanceAlerts = () => getKv<BalanceAlert[]>('balanceAlerts', []);
/** Keeps the newest 300 balance-only alerts. */
export const saveBalanceAlerts = (a: BalanceAlert[]) => setKv('balanceAlerts', [...a].sort((x, y) => y.date - x.date).slice(0, 300));
export const saveAccounts = (a: Account[]) => setKv('accounts', a);

/** Everything a backup needs, read straight from the database. */
export async function snapshot(): Promise<Snapshot> {
  const [all, mail, accounts] = await Promise.all([loadAll(), loadMail(), loadAccounts()]);
  return { txns: all.txns, rules: all.rules, cats: all.cats, lastScan: all.lastScan, mailLastScan: mail.lastScan, accounts };
}

/** Replaces all data with a backup (used by Restore). */
export function replaceAll(s: Snapshot) {
  return serial(async () => {
    const d = await db();
    await d.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync('DELETE FROM txns');
      const st = await tx.prepareAsync('INSERT OR REPLACE INTO txns (id, date, sms_id, json) VALUES (?, ?, ?, ?)');
      try { for (const t of s.txns) await st.executeAsync(t.id, t.date, t.smsId ?? null, JSON.stringify(t)); } finally { await st.finalizeAsync(); }
      const put = (k: string, v: unknown) => tx.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', k, JSON.stringify(v));
      await put('rules', s.rules);
      await put('cats', s.cats);
      await put('lastScan', s.lastScan);
      if (s.accounts) await put('accounts', s.accounts);
      const mail = await tx.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'mail');
      const m: MailState = mail ? JSON.parse(mail.value) : { account: null, lastScan: 0 };
      await put('mail', { ...m, lastScan: s.mailLastScan });
    });
    saved = new Map(s.txns.map(t => [t.id, JSON.stringify(t)]));
  });
}
