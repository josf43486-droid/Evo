import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction, Express } from 'express';
import { DATA_DIR } from './store.ts';
import { notifyOwner } from './notifications.ts';

type Bucket = { count: number; resetAt: number; blockedUntil?: number };
const buckets = new Map<string, Bucket>();
const alertCooldown = new Map<string, number>();
const eventCooldown = new Map<string, number>();
const WINDOW_MS = 5 * 60_000;
const API_LIMIT = 300;
const AUTH_WINDOW_MS = 15 * 60_000;
const AUTH_LIMIT = 15;
const MAX_BUCKETS = 20_000;

export function maskIp(ip: string): string {
  const value = String(ip || 'unknown').replace(/^::ffff:/, '');
  if (value.includes('.')) return value.split('.').map((part, i) => i === 3 ? '0' : part).join('.');
  if (value.includes(':')) return `${value.split(':').slice(0, 4).join(':')}::`;
  return 'unknown';
}

export function sameOrigin(origin: string, host: string, configuredOrigin = ''): boolean {
  try {
    const parsed = new URL(origin);
    if (configuredOrigin) {
      const configured = new URL(configuredOrigin);
      return parsed.origin === configured.origin;
    }
    return parsed.host.toLowerCase() === String(host).toLowerCase() && ['http:', 'https:'].includes(parsed.protocol);
  } catch { return false; }
}

export function isSuspiciousPath(url: string): boolean {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { return true; }
  return /(?:\.\.\/|\.\.\\|%2e%2e|\0|\.(?:env|git)(?:\/|$)|\/\.git(?:\/|$)|\/wp-admin(?:\/|$)|phpmyadmin)/i.test(decoded);
}

function writeSecurityEvent(event: string, req: Request, detail = ''): void {
  const eventKey = `${event}:${maskIp(req.ip || req.socket.remoteAddress || '')}`;
  const now = Date.now();
  if ((eventCooldown.get(eventKey) || 0) > now) return;
  eventCooldown.set(eventKey, now + 60_000);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const record = JSON.stringify({ at: new Date().toISOString(), event, ip: maskIp(req.ip || req.socket.remoteAddress || ''), method: req.method, path: String(req.path || '').slice(0, 180), detail: detail.slice(0, 240) }) + '\n';
    const file = path.join(DATA_DIR, 'security-events.jsonl');
    // Keep the audit file bounded; rotate before appending another event.
    try {
      if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.${Date.now()}.old`);
    } catch { /* first event */ }
    fs.appendFileSync(file, record, { mode: 0o600 });
  } catch (error) { console.error('[security-audit] write failed:', error); }
}

function limited(key: string, max: number, windowMs: number): { allowed: boolean; retry: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.blockedUntil && bucket.blockedUntil > now) return { allowed: false, retry: Math.ceil((bucket.blockedUntil - now) / 1000) };
  bucket.count++;
  if (bucket.count > max) {
    bucket.blockedUntil = now + Math.min(windowMs, 15 * 60_000);
    return { allowed: false, retry: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) if ((v.blockedUntil || v.resetAt) <= now) buckets.delete(k);
    while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
  return { allowed: true, retry: 0 };
}

function setHeaders(res: Response, production: boolean): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'", "script-src 'self'",
    "connect-src 'self' ws: wss: blob:", "upgrade-insecure-requests"
  ].join('; '));
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function installSecurity(app: Express, production: boolean): void {
  app.disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    setHeaders(res, production);
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const origin = req.get('origin');
      if (origin && !sameOrigin(origin, req.get('host') || '', process.env.PUBLIC_ORIGIN || '')) {
        writeSecurityEvent('origin_rejected', req, 'Cross-origin state-changing request');
        return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'مصدر الطلب غير مسموح' } });
      }
    }
    if (req.path.startsWith('/api') && isSuspiciousPath(req.path)) {
      reportSecurityIncident('suspicious_path', req, 'Rejected suspicious API path', true);
      return res.status(404).json({ message: 'Not found' });
    }
    if (req.path.startsWith('/api')) {
      const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
      const ip = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 24);
      const authRoute = req.path.startsWith('/api/auth');
      const result = limited(`${authRoute ? 'auth' : 'api'}:${ip}`, authRoute ? AUTH_LIMIT : API_LIMIT, authRoute ? AUTH_WINDOW_MS : WINDOW_MS);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retry));
        if (authRoute) reportSecurityIncident('authentication_rate_limited', req, 'Authentication rate limit exceeded', true);
        else writeSecurityEvent('rate_limited', req, 'API route');
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'طلبات كثيرة. حاول مرة أخرى بعد قليل.' } });
      }
    }
    next();
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.resetAt <= now && (!value.blockedUntil || value.blockedUntil <= now)) buckets.delete(key);
    for (const [key, until] of alertCooldown) if (until <= now) alertCooldown.delete(key);
    for (const [key, until] of eventCooldown) if (until <= now) eventCooldown.delete(key);
  }, 60_000);
  cleanup.unref();
}

export function reportSecurityIncident(kind: string, req: Request, detail = '', alert = false): void {
  writeSecurityEvent(kind, req, detail);
  if (!alert) return;
  const key = `${kind}:${maskIp(req.ip || '')}`;
  const now = Date.now();
  if ((alertCooldown.get(key) || 0) > now) return;
  alertCooldown.set(key, now + 10 * 60_000);
  void notifyOwner(`EVO | تنبيه أمني\nالحدث: ${kind}\nIP: ${maskIp(req.ip || '')}\nالمسار: ${String(req.path).slice(0, 120)}\nالتفاصيل: ${detail.slice(0, 180)}`);
}
