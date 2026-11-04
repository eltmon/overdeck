/**
 * PAN-4651 WI-15, PAN-4638 WI-9: `pan lane start --machine` sends the machine
 * to the dashboard, which places and launches the lane; `list` shows the
 * machine; `stop` goes through the lane stop route.
 */
import { describe, expect, it, vi } from 'vitest';

import { laneListCommand, laneStartCommand, laneStopCommand, type LaneCliDeps } from '../../../src/cli/commands/lane.js';
import { WORKER_EXIT } from '../../../src/cli/commands/worker.js';

interface Post { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function makeDeps(answer: { status: number; body: unknown }, lanes: unknown[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const posts: Post[] = [];
  const deps: LaneCliDeps = {
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, headers: init.headers as Record<string, string> });
        if (url.endsWith('/api/lanes')) return new Response(JSON.stringify(answer.body), { status: answer.status });
        return new Response(JSON.stringify({ stopped: true }), { status: 200 });
      }
      if (url.includes('/api/lanes?') || url.endsWith('/api/lanes')) return new Response(JSON.stringify({ lanes }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as unknown as LaneCliDeps['fetch'],
    apiUrl: () => 'http://localhost:3011',
    env: { OVERDECK_CONVERSATION: 'conv-root', OVERDECK_AGENT_ID: 'agent-pan-7' },
    readFile: vi.fn(), readStdin: vi.fn(),
    resolveLane: vi.fn(async (ref: string) => ({ id: null, name: ref, run: 'r1', key: 'k1', spawnError: null })),
    waitForLane: vi.fn(), waitForLaneSet: vi.fn(), reportLane: vi.fn(),
    now: () => 0, sleep: async () => undefined,
    stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); },
  };
  return { deps, out, err, posts };
}

const OPTIONS = { role: 'builder', key: 'k1', run: 'r1', prompt: 'Build it.', wait: false };
const REMOTE_RESULT = {
  conversation: { id: null, name: '20261101-1234', gauntletRun: 'r1', laneKey: 'k1', laneRole: 'builder' },
  cwd: '/home/desk/lanes/r1-k1',
  branch: 'r1/k1',
  iteration: 1,
  warnings: [],
  machine: { environmentId: 'env-desk', label: 'desk', reason: 'Auto → desk (CPU pressure 1%, 8 GB free, 0 agents)' },
};

function view(overrides: Record<string, unknown>) {
  return {
    id: 5, name: 'local-lane', run: 'r1', key: 'k1', role: 'builder', iteration: 1, activity: 'working', archived: false,
    report: null, criticOf: null, verdict: null, latestVerdict: null, git: null, model: 'claude-opus-5-5', costUsd: null, machine: null,
    ...overrides,
  };
}

describe('pan lane start --machine (PAN-4638 WI-9)', () => {
  it('ac1: sends machine, needs and the sender, and prints the lane on its machine', async () => {
    const { deps, out, err, posts } = makeDeps({ status: 201, body: REMOTE_RESULT });
    expect(await laneStartCommand({ ...OPTIONS, machine: 'desk', needs: 'docker, GPU' }, deps)).toBe(WORKER_EXIT.done);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ parent: 'root', machine: 'desk', needs: ['docker', 'gpu'] });
    expect(posts[0]!.headers['x-overdeck-sender']).toBe('agent-pan-7');
    expect(out).toEqual(['Lane r1/k1 builder i1: 20261101-1234 on desk in /home/desk/lanes/r1-k1']);
    expect(err).toContain('Auto → desk (CPU pressure 1%, 8 GB free, 0 agents)');
  });

  it('prints a dashboard refusal and exits 1', async () => {
    const { deps, err } = makeDeps({ status: 409, body: { code: 'no-machine-fits', error: 'No machine fits: laptop: no docker; desk: offline' } });
    expect(await laneStartCommand({ ...OPTIONS, machine: 'auto', needs: 'docker' }, deps)).toBe(WORKER_EXIT.usage);
    expect(err).toEqual(['No machine fits: laptop: no docker; desk: offline']);
  });

  it('a lane on this machine prints its conversation id as before', async () => {
    const local = { ...REMOTE_RESULT, conversation: { ...REMOTE_RESULT.conversation, id: 9 }, cwd: '/w', machine: null };
    const { deps, out, posts } = makeDeps({ status: 201, body: local });
    expect(await laneStartCommand({ ...OPTIONS, machine: 'laptop' }, deps)).toBe(WORKER_EXIT.done);
    expect(posts[0]!.body).toMatchObject({ machine: 'laptop' });
    expect(out).toEqual(['Lane r1/k1 builder i1: conv 9 (20261101-1234) in /w']);
  });
});

describe('pan lane list and stop across machines (PAN-4638 WI-9)', () => {
  it('ac3: the table has a MACHINE column; a remote lane shows its name in ID and its label in MACHINE', async () => {
    const lanes = [
      view({}),
      view({ id: null, name: '20261101-1234', role: 'critic', machine: { environmentId: 'env-fly', label: 'fly-abc', reachable: true, lastSeenAt: null } }),
      view({ id: null, name: '20261101-5678', role: 'verifier', machine: { environmentId: 'env-desk', label: 'desk', reachable: false, lastSeenAt: null } }),
    ];
    const { deps, out } = makeDeps({ status: 200, body: {} }, lanes);
    expect(await laneListCommand({}, deps)).toBe(WORKER_EXIT.done);
    const [header, local, remote, offline] = out.map((line) => line.split(/\s{2,}/));
    expect(header!.slice(0, 5)).toEqual(['ID', 'RUN/KEY', 'ROLE', 'MACHINE', 'ITER']);
    expect(local!.slice(0, 4)).toEqual(['5', 'r1/k1', 'builder', '-']);
    expect(remote!.slice(0, 4)).toEqual(['20261101-1234', 'r1/k1', 'critic', 'fly-abc']);
    expect(offline!.slice(0, 4)).toEqual(['20261101-5678', 'r1/k1', 'verifier', 'desk (offline)']);
  });

  it('stop posts the lane stop route and names a remote lane by its name', async () => {
    const { deps, out, posts } = makeDeps({ status: 200, body: {} });
    expect(await laneStopCommand('20261101-1234', deps)).toBe(WORKER_EXIT.done);
    expect(posts[0]!.url).toBe('http://localhost:3011/api/lanes/20261101-1234/stop');
    expect(out).toEqual(['Stopped lane r1/k1 (20261101-1234)']);
  });
});
