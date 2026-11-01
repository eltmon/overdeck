import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_MONTHLY_CAP_BYTES } from '../../../../packages/contracts/src/connect.ts';
import { addUsage, relayCapBytes, relayStatusOf } from '../../../../services/connect/src/relay-meter.ts';
import { fetchIceServers, TURN_TTL_SECONDS } from '../../../../services/connect/src/turn.ts';

const NOV = Date.UTC(2026, 10, 30, 23, 59, 0);
const DEC = Date.UTC(2026, 11, 1, 0, 0, 0);

describe('relay meter (PAN-2356 WI-7)', () => {
  it('reports stopped at the cap and resets in a new UTC month', () => {
    const { usage, reachedCap } = addUsage(null, RELAY_MONTHLY_CAP_BYTES, NOV, RELAY_MONTHLY_CAP_BYTES);
    expect(reachedCap).toBe(true);
    expect(relayStatusOf(usage, NOV, RELAY_MONTHLY_CAP_BYTES)).toEqual({
      month: '2026-11',
      bytesUsed: RELAY_MONTHLY_CAP_BYTES,
      capBytes: RELAY_MONTHLY_CAP_BYTES,
      stopped: true,
    });
    expect(relayStatusOf(usage, DEC, RELAY_MONTHLY_CAP_BYTES)).toEqual({
      month: '2026-12',
      bytesUsed: 0,
      capBytes: RELAY_MONTHLY_CAP_BYTES,
      stopped: false,
    });
  });

  it('reads RELAY_CAP_BYTES only when it is a positive integer', () => {
    expect(relayCapBytes(undefined)).toBe(RELAY_MONTHLY_CAP_BYTES);
    expect(relayCapBytes('1000')).toBe(1000);
    expect(relayCapBytes('0')).toBe(RELAY_MONTHLY_CAP_BYTES);
    expect(relayCapBytes('-5')).toBe(RELAY_MONTHLY_CAP_BYTES);
    expect(relayCapBytes('12abc')).toBe(RELAY_MONTHLY_CAP_BYTES);
  });
});

describe('TURN credentials (PAN-2356 WI-7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests credentials with a 600 s TTL', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }] }), {
        status: 201,
      });
    }) as unknown as typeof globalThis.fetch;
    const result = await fetchIceServers({ keyId: 'k', apiToken: 't' }, { fetch });
    expect(TURN_TTL_SECONDS).toBe(600);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ ttl: 600 });
    expect(result).toEqual({ ok: true, iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }] });
  });
});
