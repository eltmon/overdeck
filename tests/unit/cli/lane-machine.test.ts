/** PAN-4651 WI-15 (D-4651-22): `pan lane start --machine` places, launches here or refuses until PAN-4638. */
import { describe, expect, it, vi } from 'vitest';

import { laneStartCommand, type LaneCliDeps } from '../../../src/cli/commands/lane.js';
import { WORKER_EXIT } from '../../../src/cli/commands/worker.js';

function makeDeps(placement: unknown) {
  const out: string[] = [];
  const err: string[] = [];
  const posts: string[] = [];
  const remoteCalls: Array<{ path: string; body?: unknown }> = [];
  const deps: LaneCliDeps = {
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(url);
      if (url.endsWith('/api/lanes') && init?.method === 'POST') {
        return new Response(JSON.stringify({ conversation: { id: 5, name: 'conv-lane', gauntletRun: 'r1', laneKey: 'k1', laneRole: 'builder' }, cwd: '/w', iteration: 1 }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as LaneCliDeps['fetch'],
    apiUrl: () => 'http://localhost:3011',
    env: { OVERDECK_CONVERSATION: 'conv-root' },
    readFile: vi.fn(), readStdin: vi.fn(), resolveLane: vi.fn(), waitForLane: vi.fn(), waitForLaneSet: vi.fn(), reportLane: vi.fn(),
    now: () => 0, sleep: async () => undefined,
    stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); },
    remote: {
      call: vi.fn(async (path: string, init: { method: string; body?: unknown }) => {
        remoteCalls.push({ path, body: init.body });
        if (path === '/api/fleet/placement') return { status: 200, json: placement };
        return { status: 200, json: { self: { environmentId: 'env-laptop', label: 'laptop' }, links: [{ environmentId: 'env-desk', label: 'desk' }] } };
      }),
    },
  };
  return { deps, out, err, posts, remoteCalls };
}

const OPTIONS = { role: 'builder', key: 'k1', run: 'r1', prompt: 'Build it.', wait: false, machine: 'auto', needs: 'docker' };

describe('pan lane start --machine (PAN-4651 WI-15)', () => {
  it('ac15: auto placing this machine launches the lane locally', async () => {
    const { deps, posts, remoteCalls, err } = makeDeps({ ok: true, environmentId: 'env-laptop', label: 'laptop', self: true, reason: 'Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)', rejections: [] });
    expect(await laneStartCommand(OPTIONS, deps)).toBe(WORKER_EXIT.done);
    expect(remoteCalls[0]).toEqual({ path: '/api/fleet/placement', body: { gitOrigin: null, needs: ['docker'] } });
    expect(posts).toEqual(['http://localhost:3011/api/lanes']);
    expect(err).toContain('Auto → laptop (CPU pressure 1%, 8 GB free, 0 agents)');
  });

  it('ac15: auto placing desk exits 1 with the PAN-4638 line and launches nothing', async () => {
    const { deps, posts, err } = makeDeps({ ok: true, environmentId: 'env-desk', label: 'desk', self: false, reason: 'Auto → desk (…)', rejections: [] });
    expect(await laneStartCommand(OPTIONS, deps)).toBe(WORKER_EXIT.usage);
    expect(err).toEqual(['Lanes on other machines arrive with PAN-4638 (chosen: desk)']);
    expect(posts).toEqual([]);
  });

  it('ac15: no candidate prints the rejection list and exits 1', async () => {
    const { deps, err, posts } = makeDeps({ ok: false, rejections: [{ environmentId: 'env-laptop', label: 'laptop', reason: 'no docker' }, { environmentId: 'env-desk', label: 'desk', reason: 'offline' }] });
    expect(await laneStartCommand(OPTIONS, deps)).toBe(WORKER_EXIT.usage);
    expect(err).toEqual(['No machine fits: laptop: no docker; desk: offline']);
    expect(posts).toEqual([]);
  });

  it('an explicit label naming this machine launches here; another machine is refused', async () => {
    const here = makeDeps(null);
    expect(await laneStartCommand({ ...OPTIONS, machine: 'laptop', needs: undefined }, here.deps)).toBe(WORKER_EXIT.done);
    const there = makeDeps(null);
    expect(await laneStartCommand({ ...OPTIONS, machine: 'desk', needs: undefined }, there.deps)).toBe(WORKER_EXIT.usage);
    expect(there.err).toEqual(['Lanes on other machines arrive with PAN-4638 (chosen: desk)']);
  });
});
