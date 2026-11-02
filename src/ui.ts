export const C = {
  bg: '#17110C',
  card: '#241A13',
  card2: '#2E2219',
  line: '#3F3024',
  gold: '#D4AF6A',
  goldDeep: '#A8844A',
  text: '#F3E9DC',
  mute: '#A8957F',
  red: '#E38B6F',
  green: '#93C47D',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ₹ with Indian digit grouping (1,23,456). */
export function inr(n: number, decimals = false): string {
  const neg = n < 0;
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  const last3 = i.slice(-3);
  let rest = i.slice(0, -3);
  if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  return (neg ? '−' : '') + '₹' + rest + last3 + (decimals && f !== '00' ? '.' + f : '');
}

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}
export function monthLabel(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}
export function ago(ms: number): string {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDate(ms);
}
