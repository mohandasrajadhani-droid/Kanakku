import type { Txn } from './parser';

export interface Row { id: string; date: number; smsId: string | null; json: string }

/** Works out which rows changed since the last save, so only those are written. */
export function diffTxns(saved: Map<string, string>, next: Txn[]): { upserts: Row[]; deletes: string[]; cache: Map<string, string> } {
  const cache = new Map<string, string>();
  const upserts: Row[] = [];
  for (const t of next) {
    const json = JSON.stringify(t);
    cache.set(t.id, json);
    if (saved.get(t.id) !== json) upserts.push({ id: t.id, date: t.date, smsId: t.smsId ?? null, json });
  }
  const deletes = [...saved.keys()].filter(id => !cache.has(id));
  return { upserts, deletes, cache };
}
