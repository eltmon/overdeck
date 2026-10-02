/**
 * Fixed-window rate limits per (bucket, client IP) in D1 (PRD §7.11, D-12).
 * The LIMITS table is final; `hit()` is a scaffold stub that always allows and is implemented by account-rate-limit.
 */
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

export async function hit(_rc: RequestContext, _bucket: Bucket): Promise<HitResult> {
  return { ok: true };
}
