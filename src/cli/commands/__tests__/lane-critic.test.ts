/**
 * PAN-4223 WI-21: the critic flags on `pan lane start` and `pan lane report`,
 * and the FOR and VERDICT list columns. Injected fetch and lane cores.
 */
import { describe, expect, it, vi } from 'vitest';

import { laneListCommand, laneReportCommand, laneStartCommand, type LaneCliDeps } from '../lane.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(overrides: Partial<LaneCliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(201, {
    conversation: { id: 7, name: 'critic-lane', gauntletRun: 'hotel', laneKey: '663', laneRole: 'critic' },
    cwd: '/l/hotel-663-critic-i1',
    iteration: 1,
    warnings: [],
  }));
  const deps: LaneCliDeps = {
    fetch: fetchMock,
    apiUrl: () => 'http://localhost:3011',
    env: { OVERDECK_CONVERSATION: 'conv-root' },
    readFile: vi.fn(async () => '# report body'),
    readStdin: vi.fn(async () => ''),
    resolveLane: vi.fn(async () => null),
    waitForLane: vi.fn(),
    waitForLaneSet: vi.fn(),
    reportLane: vi.fn(async () => 'lane hotel/663 report 1: done, verdict NOT_YET'),
    now: () => 0,
    sleep: vi.fn(async () => undefined),
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
    ...overrides,
  };
  return { deps, fetchMock, out, err };
}

describe('pan lane critic flags (PAN-4223 WI-21)', () => {
  it('sends for and no key for a critic started with --for', async () => {
    const { deps, fetchMock } = harness();
    expect(await laneStartCommand({ role: 'critic', for: '663', run: 'hotel', prompt: 'judge', wait: false }, deps)).toBe(0);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ role: 'critic', for: '663', run: 'hotel' });
    expect(body).not.toHaveProperty('key');
  });

  it('passes --verdict, --defects and --verdict-file to reportLane', async () => {
    const { deps, err } = harness();
    expect(await laneReportCommand({ file: 'r.md', verdict: 'NOT_YET', defects: '7', verdictFile: 'v.json' }, deps)).toBe(0);
    expect(deps.reportLane).toHaveBeenCalledWith(
      { body: '# report body', status: 'done', allowUnpushed: false, verdict: 'NOT_YET', defects: 7, verdictFile: 'v.json' },
      deps.env,
    );
    expect(err).toEqual(['lane hotel/663 report 1: done, verdict NOT_YET']);
    expect(await laneReportCommand({ file: 'r.md', verdict: 'NOT_YET', defects: 'lots' }, deps)).toBe(1);
  });

  it('exits 1 when reportLane refuses the verdict', async () => {
    const { deps, err } = harness({ reportLane: vi.fn(async () => { throw new Error('one verdict per critic; launch a fresh critic'); }) });
    expect(await laneReportCommand({ file: 'r.md', verdict: 'WOWED' }, deps)).toBe(1);
    expect(err).toEqual(['one verdict per critic; launch a fresh critic']);
  });

  it('prints FOR and VERDICT cells for a critic and its builder', async () => {
    const common = { run: 'hotel', key: '663', iteration: 1, activity: 'stopped', archived: false, report: null, git: null, model: 'm', costUsd: null };
    const lanes = [
      { ...common, id: 1, name: 'b1', role: 'builder', criticOf: null, verdict: null, latestVerdict: { verdict: 'NOT_YET', defects: 7 } },
      { ...common, id: 2, name: 'c1', role: 'critic', criticOf: { id: 1, name: 'b1', key: '663', iteration: 1 }, verdict: { value: 'NOT_YET', defects: 7, file: null }, latestVerdict: null },
    ];
    const { deps, fetchMock, out } = harness();
    fetchMock.mockImplementation(async () => json(200, { generatedAt: 'now', lanes }));
    expect(await laneListCommand({ run: 'hotel' }, deps)).toBe(0);
    expect(out[0]).toMatch(/REPORT\s+FOR\s+VERDICT\s+BRANCH@SHA/);
    expect(out[1]).toMatch(/^1\s+hotel\/663\s+builder\s+1\s+stopped\s+-\s+NOT_YET 7\s+-/);
    expect(out[2]).toMatch(/^2\s+hotel\/663\s+critic\s+1\s+stopped\s+-\s+663 i1\s+NOT_YET 7\s+-/);
  });
});
