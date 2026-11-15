import type { Txn } from './parser';
import type { CustomCategory } from './categories';
import type { Account } from './accounts';

export interface Snapshot {
  txns: Txn[];
  rules: Record<string, string>;
  cats: CustomCategory[];
  lastScan: number;
  mailLastScan: number;
  accounts?: Account[];
}

const APP = 'kanakku';
const FORMAT = 1;

export function makeBackup(s: Snapshot): string {
  return JSON.stringify({ app: APP, format: FORMAT, createdAt: Date.now(), count: s.txns.length, ...s });
}

/** Reads a backup file; throws a plain-language error if it isn't a Kanakku backup. */
export function parseBackup(text: string): Snapshot & { createdAt: number } {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error('This file is not a Kanakku backup.'); }
  if (d?.app !== APP || !Array.isArray(d.txns)) throw new Error('This file is not a Kanakku backup.');
  if (d.format > FORMAT) throw new Error('This backup was made by a newer Kanakku. Update the app first.');
  const txns: Txn[] = d.txns.filter((t: any) => t && typeof t.id === 'string' && typeof t.amount === 'number' && typeof t.date === 'number');
  return {
    txns,
    rules: d.rules && typeof d.rules === 'object' ? d.rules : {},
    cats: Array.isArray(d.cats) ? d.cats : [],
    lastScan: Number(d.lastScan) || 0,
    mailLastScan: Number(d.mailLastScan) || 0,
    accounts: Array.isArray(d.accounts) ? d.accounts : [],
    createdAt: Number(d.createdAt) || 0,
  };
}
