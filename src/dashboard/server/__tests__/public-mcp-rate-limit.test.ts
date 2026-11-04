/**
 * PAN-4947 WI-4: the fixed-window limiter, driven by an injected clock.
 */
import { describe, expect, it } from 'vitest';

import { createFixedWindowLimiter } from '../public-mcp-rate-limit.js';

function limiterAt(start = 1_000_000, opts: { maxKeys?: number } = {}) {
  const clock = { now: start };
  const limiter = createFixedWindowLimiter({ now: () => clock.now, ...opts });
  return { clock, limiter };
}

function hitTimes(limiter: ReturnType<typeof createFixedWindowLimiter>, key: string, limit: number, times: number): void {
  for (let i = 0; i < times; i += 1) expect(limiter.hit(key, limit)).toEqual({ allowed: true });
}

describe('createFixedWindowLimiter (PAN-4947)', () => {
  it('allows 60 hits with limit 60 and refuses the 61st with Retry-After from the window start', () => {
    const { clock, limiter } = limiterAt();
    hitTimes(limiter, 'token:a', 60, 60);
    expect(limiter.hit('token:a', 60)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    clock.now += 45_000;
    expect(limiter.hit('token:a', 60)).toEqual({ allowed: false, retryAfterSeconds: 15 });
  });

  it('starts a fresh window after 60 s', () => {
    const { clock, limiter } = limiterAt();
    hitTimes(limiter, 'ip:x', 20, 20);
    expect(limiter.hit('ip:x', 20).allowed).toBe(false);
    clock.now += 60_000;
    hitTimes(limiter, 'ip:x', 20, 20);
    expect(limiter.hit('ip:x', 20).allowed).toBe(false);
  });

  it('never answers Retry-After below 1', () => {
    const { clock, limiter } = limiterAt();
    hitTimes(limiter, 'ip:x', 1, 1);
    clock.now += 59_999;
    expect(limiter.hit('ip:x', 1)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('keeps keys independent', () => {
    const { limiter } = limiterAt();
    hitTimes(limiter, 'ip:a', 20, 20);
    expect(limiter.hit('ip:a', 20).allowed).toBe(false);
    expect(limiter.hit('ip:b', 20)).toEqual({ allowed: true });
  });

  it('refuses the 21st hit with limit 20', () => {
    const { limiter } = limiterAt();
    hitTimes(limiter, 'ip:a', 20, 20);
    expect(limiter.hit('ip:a', 20).allowed).toBe(false);
  });

  it('evicts the oldest-inserted key when full', () => {
    const { limiter } = limiterAt(1_000_000, { maxKeys: 3 });
    hitTimes(limiter, 'k1', 1, 1);
    hitTimes(limiter, 'k2', 1, 1);
    hitTimes(limiter, 'k3', 1, 1);
    expect(limiter.hit('k1', 1).allowed).toBe(false);
    hitTimes(limiter, 'k4', 1, 1);
    expect(limiter.size()).toBe(3);
    // k1 was evicted, so it starts a fresh window; k2 is next out.
    expect(limiter.hit('k1', 1)).toEqual({ allowed: true });
    expect(limiter.size()).toBe(3);
    expect(limiter.hit('k3', 1).allowed).toBe(false);
    expect(limiter.hit('k2', 1)).toEqual({ allowed: true });
  });
});
