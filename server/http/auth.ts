// Optional single-password protection for hosted demos (DEMO_PASSWORD).
// Production would replace this with real per-user accounts.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.ts';

const COOKIE = 'hc_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(secret: string, issuedAt: number): string {
  return createHmac('sha256', secret).update(`session:${issuedAt}`).digest('base64url');
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function isAuthenticated(config: AppConfig, req: Request): boolean {
  if (!config.demoPassword) return true;
  const value = readCookie(req, COOKIE);
  if (!value) return false;
  const [issued, sig] = value.split('.');
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS || !sig) return false;
  const expected = Buffer.from(sign(config.sessionSecret, issuedAt));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordMatches(config: AppConfig, password: unknown): boolean {
  if (!config.demoPassword || typeof password !== 'string') return false;
  const a = createHmac('sha256', 'pw').update(password).digest();
  const b = createHmac('sha256', 'pw').update(config.demoPassword).digest();
  return timingSafeEqual(a, b);
}

export function setSessionCookie(config: AppConfig, req: Request, res: Response): void {
  const issuedAt = Date.now();
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${issuedAt}.${sign(config.sessionSecret, issuedAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function requireAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAuthenticated(config, req)) return next();
    res.status(401).json({ error: 'Sign in required' });
  };
}

/** Very small in-memory limiter for the login endpoint. */
export function loginLimiter() {
  const attempts = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.reset < now) {
      attempts.set(key, { count: 1, reset: now + 60_000 });
      return next();
    }
    entry.count++;
    if (entry.count > 10) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    next();
  };
}
