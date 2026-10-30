const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 'Thu, Oct 8' */
export function shortDate(date: string): string {
  const d = parse(date);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'Thursday, October 8' */
export function longDate(date: string): string {
  const d = parse(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

export function dayName(date: string): string {
  return DAYS[parse(date).getUTCDay()];
}

export function dayNum(date: string): number {
  return parse(date).getUTCDate();
}

export function monthShort(date: string): string {
  return MONTHS[parse(date).getUTCMonth()];
}

export function addDays(date: string, n: number): string {
  return new Date(parse(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return parse(date).getUTCDay();
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function moneyRound(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Relative-ish timestamp: 'Just now', '12 min ago', 'Today 5:02 PM', 'Oct 3, 9:00 AM'. */
export function when(iso: string, timeZone?: string): string {
  const t = new Date(iso);
  const diff = Date.now() - t.getTime();
  if (diff < 60_000 && diff > -60_000) return 'Just now';
  if (diff > 0 && diff < 60 * 60_000) return `${Math.round(diff / 60_000)} min ago`;
  const opts: Intl.DateTimeFormatOptions = { timeZone, hour: 'numeric', minute: '2-digit' };
  const sameDay = new Date().toLocaleDateString('en-CA', { timeZone }) === t.toLocaleDateString('en-CA', { timeZone });
  if (sameDay) return `Today ${t.toLocaleTimeString('en-US', opts)}`;
  return t.toLocaleString('en-US', { ...opts, month: 'short', day: 'numeric' });
}

export function pct(n: number, d: number): string {
  if (!d) return '0%';
  return `${Math.round((n / d) * 100)}%`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`;
}

export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}
