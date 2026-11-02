/**
 * PAN-4638 WI-5: `POST /api/lanes` resolves `machine` and launches through the
 * owner's lane work door. The real lane core and target resolver run against a
 * temp OVERDECK_HOME; links, git, the owner and the runtime are fakes.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lanes-route-machine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

vi.mock('../../event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));

const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
const { launchLane } = await import('../../../../lib/lanes/launch.js');
const { readRemoteLane } = await import('../../../../lib/lanes/remote-lanes.js');
const { resolveTargetMachine } = await import('../../services/fleet-target.js');
const { readJsonResponse } = await import('../machines-work.js');
const { handleLaneLaunch } = await import('../lanes.js');

type LaneRouteDeps = import('../lanes.js').LaneRouteDeps;
type LaunchDeps = NonNullable<Parameters<typeof launchLane>[1]>;
type MachineLink = import('../../../../lib/anywhere/link-store.js').MachineLink;
type FleetTargetDeps = import('../../services/fleet-target.js').FleetTargetDeps;

const PROJECT_PATH = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');
const ORIGIN = 'github.com/eltmon/lexerra';
const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as unknown as MachineLink;
const AGENT = { actor: { agentId: 'agent-pan-7' } } as const;

const LOCAL_DEPS = {
  git: {
    fetchBase: vi.fn(async () => null),
    addBranchWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    addDetachedWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    applySparse: vi.fn(async () => undefined),
  },
  resolveConfig: async () => ({
    projectKey: 'lexerra',
    projectPath: PROJECT_PATH,
    lanesRoot: LANES_ROOT,
    baseRef: 'origin/main',
    sparseCheckout: null,
    roles: { builder: { model: 'claude-opus-5-5' } },
  }),
  resolveHarness: async () => 'claude-code' as const,
  isAlive: async () => false,
  start: vi.fn(async () => undefined),
  emitCreated: () => undefined,
  sleep: async () => undefined,
  homeDir: () => TEST_HOME,
  tmpRoot: join(TEST_HOME, 'tmp'),
  cpuPressure: async () => ({ saturated: false, signal: 'psi-some-avg60' as const, reading: 1, threshold: 50, psiSomeAvg10: 1 }),
} satisfies LaunchDeps;

const TARGET_DEPS = {
  self: async () => ({ environmentId: 'env-home', label: 'home' }),
  links: async () => [DESK],
  status: () => ({ state: 'online', tags: [] }),
  selfProfile: () => null,
} as unknown as FleetTargetDeps;

function deps(fetchPeer: LaneRouteDeps['fetchPeer']) {
  const value: LaneRouteDeps = {
    resolveTarget: (machine, gitOrigin, needs) => resolveTargetMachine(machine, gitOrigin, needs, TARGET_DEPS),
    projectOrigin: (projectKey) => (projectKey === 'lexerra' ? { gitOrigin: ORIGIN } : null),
    thisLabel: async () => 'home',
    fetchPeer,
    launch: (request, launchDeps) => launchLane(request, { ...LOCAL_DEPS, ...launchDeps }),
    flyEnvironmentIds: async () => [],
    follow: vi.fn(),
    stopLocal: vi.fn(async () => undefined),
    now: () => new Date(),
  };
  return value;
}

const owner = () => vi.fn(async (_environmentId: string, _path: string, init: { body: unknown }) => {
  const spec = init.body as { name: string; branch: string | null };
  return { status: 201, json: { name: spec.name, cwd: `/home/desk/lanes/${spec.name}`, branch: spec.branch, warnings: [] } };
});

let rootCount = 0;
function root(): string {
  rootCount += 1;
  const name = `route-root-${rootCount}`;
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: PROJECT_PATH, workspaceId: null, projectKey: 'lexerra' });
  return name;
}

const request = (parent: string, key: string, machine?: string) => ({ parent, run: 'hotel', key, role: 'builder' as const, brief: '# brief', ...(machine ? { machine } : {}) });

beforeEach(() => {
  mkdirSync(PROJECT_PATH, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('POST /api/lanes with a machine (PAN-4638 WI-5)', () => {
  it('ac1: launches on a linked machine through its lane door, as the caller, and follows the lane', async () => {
    const fetchPeer = owner();
    const d = deps(fetchPeer);
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r1', 'desk'), { viaChannel: false, caller: AGENT }, d));

    expect(response.status).toBe(201);
    const body = response.body as { conversation: { id: number | null; name: string }; machine: { label: string } };
    expect(body.machine).toEqual({ environmentId: 'env-desk', label: 'desk', reason: null });
    expect(body.conversation.id).toBeNull();
    const [environmentId, path, init] = fetchPeer.mock.calls[0]!;
    expect(environmentId).toBe('env-desk');
    expect(path).toBe('/api/machines/work/lanes');
    expect(init).toMatchObject({ method: 'POST', actor: { agentId: 'agent-pan-7' }, body: { gitOrigin: ORIGIN, key: 'r1', name: body.conversation.name } });
    expect(d.follow).toHaveBeenCalledWith(body.conversation.name);
    expect(await readRemoteLane(body.conversation.name)).not.toBeNull();
  });

  it('ac2: this machine\'s own label launches locally and calls no link', async () => {
    const fetchPeer = owner();
    const d = deps(fetchPeer);
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r2', 'home'), { viaChannel: false, caller: AGENT }, d));
    expect(response.status).toBe(201);
    const body = response.body as { conversation: { name: string }; machine: unknown };
    expect(body.machine).toBeNull();
    expect(getConversationByName(body.conversation.name)?.laneKey).toBe('r2');
    expect(fetchPeer).not.toHaveBeenCalled();
    expect(d.follow).not.toHaveBeenCalled();
  });

  it('ac3: a request through a secure channel may not place a lane on another machine', async () => {
    const fetchPeer = owner();
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r3', 'desk'), { viaChannel: true, caller: AGENT }, deps(fetchPeer)));
    expect(response).toMatchObject({ status: 403, body: { code: 'no-chained-hops' } });
    expect(fetchPeer).not.toHaveBeenCalled();
  });

  it('ac4: machine fly answers 400 fly-unavailable', async () => {
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r4', 'fly'), { viaChannel: false, caller: AGENT }, deps(owner())));
    expect(response).toMatchObject({ status: 400, body: { code: 'fly-unavailable' } });
  });

  it('passes an owner project-missing through with the add-project hint and keeps no stand-in', async () => {
    const fetchPeer = vi.fn(async () => ({ status: 404, json: { code: 'project-missing', gitOrigin: ORIGIN, error: 'desk has no project' } }));
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r5', 'desk'), { viaChannel: false, caller: AGENT }, deps(fetchPeer)));
    expect(response).toMatchObject({ status: 404, body: { code: 'project-missing' } });
    expect((response.body as { error: string }).error).toContain('pan machines add-project home lexerra --to desk');
  });

  it('answers 503 machine-unreachable when the owner cannot be reached', async () => {
    const fetchPeer = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const response = readJsonResponse(await handleLaneLaunch(request(root(), 'r6', 'desk'), { viaChannel: false, caller: AGENT }, deps(fetchPeer)));
    expect(response).toMatchObject({ status: 503, body: { code: 'machine-unreachable' } });
    expect((response.body as { error: string }).error).toBe('desk: ECONNREFUSED');
  });
});
