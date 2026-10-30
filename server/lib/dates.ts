// Calendar math. Service dates are plain 'YYYY-MM-DD' strings in the tenant's
// local time zone, so a pickup on "Thursday" is never shifted by UTC offsets.

const DAY_MS = 86_400_000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value).getTime());
}

export function todayIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Local wall-clock time as 'HH:MM'. */
export function timeIn(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

export function addDays(date: string, days: number): string {
  return fmt(new Date(parse(date).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return parse(date).getUTCDay();
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** First date on or after `from` that falls on `serviceDay` (1 = Mon … 5 = Fri). */
export function nextWeekday(from: string, serviceDay: number): string {
  const diff = (serviceDay - weekday(from) + 7) % 7;
  return addDays(from, diff);
}

export function longDate(date: string): string {
  const d = parse(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function shortDate(date: string): string {
  const d = parse(date);
  return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

export function monthDay(date: string): string {
  const d = parse(date);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Next billing due date on or after `today` for a given day-of-month. */
export function nextDueDate(today: string, dueDay: number): string {
  const d = parse(today);
  let candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dueDay));
  if (fmt(candidate) < today) candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dueDay));
  return fmt(candidate);
}

/** Most recent billing due date on or before `today`. */
export function lastDueDate(today: string, dueDay: number): string {
  const d = parse(today);
  let candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dueDay));
  if (fmt(candidate) > today) candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, dueDay));
  return fmt(candidate);
}

// ── Holidays ───────────────────────────────────────────────────────────────

export interface Holiday {
  name: string;
  date: string;
}

function nthWeekdayOfMonth(year: number, month: number, wd: number, n: number): string {
  const first = fmt(new Date(Date.UTC(year, month, 1)));
  return addDays(first, ((wd - weekday(first) + 7) % 7) + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, wd: number): string {
  const last = fmt(new Date(Date.UTC(year, month + 1, 0)));
  return addDays(last, -((weekday(last) - wd + 7) % 7));
}

/** The six holidays most residential haulers (including Kestrel Ridge) observe. */
export function observedHolidays(year: number): Holiday[] {
  return [
    { name: "New Year's Day", date: `${year}-01-01` },
    { name: 'Memorial Day', date: lastWeekdayOfMonth(year, 4, 1) },
    { name: 'Independence Day', date: `${year}-07-04` },
    { name: 'Labor Day', date: nthWeekdayOfMonth(year, 8, 1, 1) },
    { name: 'Thanksgiving Day', date: nthWeekdayOfMonth(year, 10, 4, 4) },
    { name: 'Christmas Day', date: `${year}-12-25` },
  ];
}

export function upcomingHolidays(today: string, count = 4): Holiday[] {
  const year = Number(today.slice(0, 4));
  return [...observedHolidays(year), ...observedHolidays(year + 1)]
    .filter((h) => h.date >= today)
    .slice(0, count);
}

/** Weekday holidays slide the rest of that week's pickups by one day (Fri → Sat). */
export function holidayAffectsService(date: string): boolean {
  const wd = weekday(date);
  return wd >= 1 && wd <= 5;
}
