// Phone/email helpers shared by providers, the live allowlist and seed data.

/** Converts a US phone number to E.164 (+1XXXXXXXXXX). Returns null if it isn't one. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.trim().startsWith('+') && digits.length >= 8) return `+${digits}`;
  return null;
}

/** Canonical form used to compare recipients (allowlist, STOP replies). */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return toE164(trimmed) ?? trimmed;
}

export function formatPhone(phone: string): string {
  const e164 = toE164(phone);
  if (!e164 || !e164.startsWith('+1')) return phone;
  const d = e164.slice(2);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Reserved fictional contact ranges. These can never be delivered for real:
 * 555-0100 through 555-0199 numbers and example.com/.test email domains.
 */
export function isFictionalAddress(value: string): boolean {
  if (value.includes('@')) {
    const domain = value.split('@')[1]?.toLowerCase() ?? '';
    return /(^|\.)example\.(com|org|net)$/.test(domain) || domain.endsWith('.test') || domain.endsWith('.example');
  }
  const e164 = toE164(value);
  if (!e164) return true;
  return /^\+1\d{3}55501\d{2}$/.test(e164);
}

export function maskAddress(value: string): string {
  if (value.includes('@')) {
    const [user, domain] = value.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  const e164 = toE164(value);
  if (!e164) return '***';
  return `(***) ***-${e164.slice(-4)}`;
}
