/**
 * Fixed-window rate limits per (bucket, client IP) in D1 (PRD PAN-4293 §7.11, D-12).
 *
 * routes.ts applies the per-route bucket before dispatch; device-flow.ts counts `activate-fail` itself.
 * The client IP (CF-Connecting-IP, or 'unknown') is hashed before it is stored (NFR-3). One upsert both
 * counts and rolls the window, so two concurrent requests cannot both reset it.
 */
import { sha256Hex } from './crypto.ts';
import type { RequestContext } from './env.ts';

export const LIMITS = {
  'auth-start': { limit: 20, windowMs: 600_000 },
  'github-callback': { limit: 30, windowMs: 600_000 },
  'device-code': { limit: 10, windowMs: 600_000 },
  token: { limit: 120, windowMs: 600_000 },
  activate: { limit: 30, windowMs: 900_000 },
  'activate-fail': { limit: 10, windowMs: 900_000 },
  'admin-login': { limit: 10, windowMs: 600_000 },
} as const;

export type Bucket = keyof typeof LIMITS;

export type HitResult = { ok: true } | { ok: false; retryAfterS: number };

export type RateLimitContext = Pick<RequestContext, 'env' | 'deps' | 'clientIp'>;

export function clientKey(rc: Pick<RequestContext, 'clientIp'>): Promise<string> {
  return sha256Hex(rc.clientIp || 'unknown');
}

/** Reads the current window for `bucket` without counting; `ok: false` while the window is already exhausted. */
export async function peek(rc: RateLimitContext, bucket: Bucket): Promise<HitResult> {
  const { limit, windowMs } = LIMITS[bucket];
  const now = rc.deps.now();
  const row = await rc.env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE bucket = ? AND client_hash = ?')
    .bind(bucket, await clientKey(rc))
    .first<{ window_start: number; count: number }>();
  if (!row || row.window_start <= now - windowMs || row.count < limit) return { ok: true };
  return { ok: false, retryAfterS: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
}

/** Counts one request against `bucket` for this client; refuses once the window's count exceeds the limit. */
export async function hit(rc: RateLimitContext, bucket: Bucket): Promise<HitResult> {
  const { limit, windowMs } = LIMITS[bucket];
  const now = rc.deps.now();
  const row = await rc.env.DB.prepare(
    `INSERT INTO rate_limits (bucket, client_hash, window_start, count) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT (bucket, client_hash) DO UPDATE SET
       count        = CASE WHEN rate_limits.window_start <= ?3 - ?4 THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ?3 - ?4 THEN ?3 ELSE rate_limits.window_start END
     RETURNING window_start, count`,
  )
    .bind(bucket, await clientKey(rc), now, windowMs)
    .first<{ window_start: number; count: number }>();
  if (!row) throw new Error('rate_limits upsert returned no row');
  if (row.count <= limit) return { ok: true };
  return { ok: false, retryAfterS: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
}
