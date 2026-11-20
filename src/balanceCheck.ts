import type { Account } from './accounts';

/**
 * Missed-call balance enquiry numbers (source: BankBazaar list, Federal Bank's own page; Nov 2026).
 * Banks change these sometimes, so each account lets you edit the number.
 * Keys match the bank names Kanakku shows on entries.
 */
export const BALANCE_NUMBERS: Record<string, string> = {
  'SBI': '9223766666',
  'HDFC': '18002703333',
  'ICICI': '9594612612',
  'Axis': '18004195959',
  'Kotak': '18002740110',
  'Federal': '8431900900',
  'South Indian': '9223008488',
  'Canara': '8886610360',
  'Union': '9223008586',
  'Bank of Baroda': '8468001111',
  'PNB': '18001802223',
  'Bank of India': '9266135135',
  'Indian Bank': '9677633000',
  'IOB': '9210622122',
  'IDFC First': '18002700720',
  'IndusInd': '18002741000',
  'Yes Bank': '9223920000',
  'Central Bank': '9555244442',
  'KVB': '9266292666',
};

export function checkNumberFor(acc: Account): string | undefined {
  if (acc.checkNumber) return acc.checkNumber;
  if (!acc.bank || acc.kind !== 'bank') return undefined;
  const key = Object.keys(BALANCE_NUMBERS).find(k => k.toLowerCase() === acc.bank!.toLowerCase());
  return key ? BALANCE_NUMBERS[key] : undefined;
}
