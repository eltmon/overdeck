/**
 * PAN-4645 WI-18: the heartbeat payload, the SSE encoding/parsing, and the
 * server-side source cadence (immediate, every 15 s, after a stall).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeProbeGap, resetEventLoopMonitorForTests } from '../event-loop-monitor.js';
import {
  encodeHeartbeatEvent,
  HEARTBEAT_SEND_INTERVAL_MS,
  heartbeatPayload,
  parseSseEvents,
  setHeartbeatEndpointsHashSource,
  startHeartbeatSource,
} from '../link-heartbeat.js';

afterEach(() => {
  resetEventLoopMonitorForTests();
  setHeartbeatEndpointsHashSource(null);
  vi.useRealTimers();
});

describe('link heartbeat (PAN-4645 WI-18)', () => {
  it('builds the payload from the stall record and endpoints hash and round-trips it through SSE', () => {
    expect(heartbeatPayload(3, '0.73.0')).toEqual({ seq: 3, lastStall: null, endpointsHash: '', serverVersion: '0.73.0' });
    setHeartbeatEndpointsHashSource(() => 'abcdef0123456789');
    observeProbeGap(5250, 1_000_000);
    const payload = heartbeatPayload(4, '0.73.0');
    expect(payload.endpointsHash).toBe('abcdef0123456789');
    expect(payload.lastStall).toMatchObject({ durationMs: 5000 });

    const wire = encodeHeartbeatEvent(payload);
    expect(wire.startsWith('event: heartbeat\ndata: ')).toBe(true);
    const half = wire.slice(0, 20);
    expect(parseSseEvents(half)).toEqual({ events: [], rest: half });
    const parsed = parseSseEvents(`: keepalive\n\n${wire}${wire.slice(0, 5)}`);
    expect(parsed.events).toEqual([{ event: 'heartbeat', data: JSON.stringify(payload) }]);
    expect(parsed.rest).toBe(wire.slice(0, 5));
  });

  it('sends at once, every 15 s, and right after a stall; stop ends it', () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    let stallListener: (() => void) | null = null;
    const source = startHeartbeatSource('0.73.0', (chunk) => chunks.push(chunk), {
      onStall: (listener) => { stallListener = () => listener({ durationMs: 3000, endedAt: Date.now() }); return () => { stallListener = null; }; },
    });
    expect(chunks).toHaveLength(1);
    vi.advanceTimersByTime(HEARTBEAT_SEND_INTERVAL_MS);
    expect(chunks).toHaveLength(2);
    stallListener!();
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => (JSON.parse(parseSseEvents(chunk).events[0]!.data) as { seq: number }).seq)).toEqual([1, 2, 3]);
    source.stop();
    vi.advanceTimersByTime(HEARTBEAT_SEND_INTERVAL_MS * 3);
    expect(chunks).toHaveLength(3);
    expect(stallListener).toBeNull();
  });
});
