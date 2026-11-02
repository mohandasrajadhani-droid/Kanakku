import type { Mode, TxnType } from './parser';

export interface Category {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
  income?: boolean;
}

export const CATEGORIES: Category[] = [
  { name: 'Food & Dining', icon: '🍛', color: '#E0A458', keywords: ['swiggy', 'zomato', 'restaurant', 'hotel', 'cafe', 'bakery', 'bakes', 'dominos', 'pizza', 'kfc', 'mcdonald', 'eatsure', 'tea', 'juice', 'biryani'] },
  { name: 'Groceries', icon: '🛒', color: '#9CB86B', keywords: ['bigbasket', 'blinkit', 'zepto', 'supermarket', 'hypermarket', 'grocery', 'dmart', 'jiomart', 'lulu', 'reliance fresh', 'more retail', 'margin free', 'vegetables', 'stores'] },
  { name: 'Fuel', icon: '⛽', color: '#D9734E', keywords: ['petrol', 'fuel', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'bharat petroleum', 'hindustan petroleum', 'filling', 'shell'] },
  { name: 'Bills & Utilities', icon: '💡', color: '#E8C872', keywords: ['kseb', 'electricity', 'water authority', 'kwa', 'broadband', 'bsnl', 'gas', 'lpg', 'indane', 'bharatgas', 'kerala vision', 'asianet', 'bbps'] },
  { name: 'Mobile & DTH', icon: '📱', color: '#7FB2C9', keywords: ['jio', 'airtel', 'vodafone', 'vi', 'recharge', 'dth', 'tata play', 'sun direct'] },
  { name: 'Shopping', icon: '🛍️', color: '#C98BB9', keywords: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'decathlon', 'croma', 'reliance digital', 'textiles', 'silks'] },
  { name: 'Travel', icon: '🚗', color: '#8C9EDB', keywords: ['irctc', 'uber', 'ola', 'rapido', 'redbus', 'makemytrip', 'goibibo', 'ksrtc', 'indigo', 'air india', 'metro', 'fastag', 'parking', 'toll'] },
  { name: 'Health', icon: '💊', color: '#6FC2A6', keywords: ['pharmacy', 'medical', 'medicals', 'hospital', 'clinic', 'apollo', 'medplus', 'lab', 'diagnostic', '1mg', 'pharmeasy', 'aster'] },
  { name: 'Entertainment', icon: '🎬', color: '#B497D6', keywords: ['netflix', 'prime video', 'hotstar', 'spotify', 'bookmyshow', 'youtube', 'cinema', 'theatre', 'pvr'] },
  { name: 'Education', icon: '📚', color: '#A3C4BC', keywords: ['school', 'college', 'fees', 'tuition', 'udemy', 'coursera', 'byju'] },
  { name: 'EMI & Loans', icon: '🏦', color: '#C47A6B', keywords: ['emi', 'loan', 'nach', 'ecs', 'mandate', 'finance ltd', 'bajaj fin'] },
  { name: 'Insurance', icon: '🛡️', color: '#8FA9B5', keywords: ['insurance', 'lic', 'premium', 'policy'] },
  { name: 'Investments', icon: '📈', color: '#D4AF6A', keywords: ['zerodha', 'groww', 'upstox', 'angel one', 'mutual fund', 'sip', 'nse clearing', 'bse', 'indian clearing', 'smallcase'] },
  { name: 'Cash Withdrawal', icon: '💵', color: '#B8A27A', keywords: [] },
  { name: 'Transfers', icon: '🔁', color: '#9E8C7A', keywords: [] },
  { name: 'Card Bill', icon: '💳', color: '#7D6B5A', keywords: ['cred', 'cheq', 'credit card bill', 'cc bill', 'cc payment'] },
  { name: 'Others', icon: '•', color: '#8A7B6B', keywords: [] },
  { name: 'Salary', icon: '💼', color: '#8FBF7F', keywords: [], income: true },
  { name: 'Refund', icon: '↩️', color: '#7FBFA8', keywords: [], income: true },
  { name: 'Received', icon: '⬇️', color: '#A9C98F', keywords: [], income: true },
];

export const EXPENSE_CATEGORIES = CATEGORIES.filter(c => !c.income);
export const INCOME_CATEGORIES = CATEGORIES.filter(c => c.income);

const byName: Record<string, Category> = Object.fromEntries(CATEGORIES.map(c => [c.name, c]));
export function catMeta(name: string): Category {
  return byName[name] || byName.Others;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = EXPENSE_CATEGORIES.filter(c => c.keywords.length).map(c => ({
  name: c.name,
  re: new RegExp('\\b(' + c.keywords.map(escape).join('|') + ')\\b', 'i'),
}));

/** Categories that should not count toward spending (would double count). */
export const EXCLUDED_BY_DEFAULT = new Set(['Card Bill']);

export function categorize(merchant: string, body: string, type: TxnType, mode: Mode): string {
  if (type === 'credit') {
    if (/\b(salary|sal|payroll)\b/i.test(body)) return 'Salary';
    if (/\b(refund|refunded|reversed|reversal|cashback)\b/i.test(body)) return 'Refund';
    return 'Received';
  }
  if (mode === 'ATM') return 'Cash Withdrawal';
  for (const m of MATCHERS) if (m.re.test(merchant)) return m.name;
  if (/^\d{10}@/.test(merchant)) return 'Transfers';
  for (const m of MATCHERS) {
    if (m.name === 'Card Bill') continue; // only match card bills on the payee, not the SMS text
    if (m.re.test(body)) return m.name;
  }
  return 'Others';
}
