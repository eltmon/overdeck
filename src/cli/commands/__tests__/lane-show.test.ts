/**
 * PAN-4223 WI-21 step 4: `pan lane show` prints the builder → critic chain.
 * Injected fetch; the live dashboard is never called.
 */
import { describe, expect, it, vi } from 'vitest';

import { laneShowCommand, type LaneCliDeps } from '../lane.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const base = { run: 'hotel', key: '663', archived: false, git: null, model: 'm', costUsd: null, latestVerdict: null, critics: [], answering: null };
const LANES = [
  { ...base, id: 1, name: 'b1', role: 'builder', iteration: 1, createdAt: '2026-09-26T10:00:00.000Z', activity: 'stopped', report: { seq: 1, status: 'done' }, criticOf: null, verdict: null },
  { ...base, id: 2, name: 'c1', role: 'critic', iteration: 1, createdAt: '2026-09-26T10:10:00.000Z', activity: 'stopped', report: { seq: 1, status: 'done' }, criticOf: { id: 1, name: 'b1', key: '663', iteration: 1 }, verdict: { value: 'NOT_YET', defects: 7, file: '/v/c1.json' } },
  { ...base, id: 3, name: 'b2', role: 'builder', iteration: 2, createdAt: '2026-09-26T10:20:00.000Z', activity: 'stopped', report: { seq: 1, status: 'done' }, criticOf: null, verdict: null },
  { ...base, id: 4, name: 'c2', role: 'critic', iteration: 2, createdAt: '2026-09-26T10:30:00.000Z', activity: 'idle', report: { seq: 1, status: 'done' }, criticOf: { id: 3, name: 'b2', key: '663', iteration: 2 }, verdict: { value: 'WOWED', defects: null, file: null } },
];

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/lanes/b1')) return json(200, LANES[0]);
    if (url.includes('/api/lanes/nope')) return json(404, { error: 'nope is not a lane' });
    return json(200, { generatedAt: 'now', lanes: LANES });
  });
  const deps: LaneCliDeps = {
    fetch: fetchMock,
    apiUrl: () => 'http://localhost:3011',
    env: {},
    readFile: vi.fn(),
    readStdin: vi.fn(),
    resolveLane: vi.fn(async () => null),
    waitForLane: vi.fn(),
    waitForLaneSet: vi.fn(),
    reportLane: vi.fn(),
    now: () => 0,
    sleep: vi.fn(),
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
  };
  return { deps, fetchMock, out, err };
}

describe('pan lane show (PAN-4223 WI-21)', () => {
  it('prints the chain for a builder lane, then one line per lane', async () => {
    const { deps, fetchMock, out } = harness();
    expect(await laneShowCommand('conv-b1', {}, deps)).toBe(0);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://localhost:3011/api/lanes?run=hotel&key=663');
    expect(out[0]).toBe('i1 built → critic c1: NOT_YET (7 defects) → i2 built → critic c2: WOWED');
    expect(out.slice(1)).toEqual([
      '#1 builder i1 stopped - -',
      '#2 critic i1 stopped NOT_YET /v/c1.json',
      '#3 builder i2 stopped - -',
      '#4 critic i2 idle WOWED -',
    ]);
  });

  it('exits 1 with neither form, with both forms, and for an unknown lane', async () => {
    const { deps, err } = harness();
    expect(await laneShowCommand(undefined, {}, deps)).toBe(1);
    expect(await laneShowCommand(undefined, { run: 'hotel' }, deps)).toBe(1);
    expect(await laneShowCommand('b1', { run: 'hotel', key: '663' }, deps)).toBe(1);
    expect(err.slice(0, 3)).toEqual(Array(3).fill('pan lane show needs <lane> or --run and --key'));
    expect(await laneShowCommand('nope', {}, deps)).toBe(1);
  });

  it('prints { run, key, steps } with --json', async () => {
    const { deps, out } = harness();
    expect(await laneShowCommand(undefined, { run: 'hotel', key: '663', json: true }, deps)).toBe(0);
    const payload = JSON.parse(out[0] ?? '{}') as { run: string; key: string; steps: Array<{ kind: string }> };
    expect(payload).toMatchObject({ run: 'hotel', key: '663' });
    expect(payload.steps.map((step) => step.kind)).toEqual(['builder', 'critic', 'builder', 'critic']);
  });
});
