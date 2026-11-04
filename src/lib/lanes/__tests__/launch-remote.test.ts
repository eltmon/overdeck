/**
 * PAN-4638 WI-4: the lane door launches on another machine through
 * `deps.remote`. Real conversations DB and stand-in store in a temp
 * OVERDECK_HOME; the owner, git, liveness and runtime are fakes.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-launch-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, getConversationByName } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { workerDir } = await import('../../agents/worker/ids.js');
const { launchLane } = await import('../launch.js');
const { readCriticLink, readRemoteLane, remoteLanesRoot, writeRemoteLaneMirror } = await import('../remote-lanes.js');
const { LaneLaunchError } = await import('../types.js');

type Deps = NonNullable<Parameters<typeof launchLane>[1]>;
type Request = Parameters<typeof launchLane>[0];
type Remote = NonNullable<Deps['remote']>;
type Spec = Parameters<Remote['launch']>[0];
type LaneConfig = Awaited<ReturnType<NonNullable<Deps['resolveConfig']>>>;

const PROJECT_PATH = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');

const CPU_SATURATED = { saturated: true, signal: 'psi-some-avg60' as const, reading: 55, threshold: 50, psiSomeAvg10: 60 };

function config(): LaneConfig {
  return {
    projectKey: 'lexerra',
    projectPath: PROJECT_PATH,
    lanesRoot: LANES_ROOT,
    baseRef: 'origin/main',
    sparseCheckout: null,
    roles: { builder: { model: 'claude-opus-5-5' }, critic: { model: 'claude-opus-5-5', effort: 'high' } },
  };
}

function ownerCwd(spec: Spec): string {
  return `/home/desk/lanes/${spec.run}-${spec.key}-${spec.role}-i${spec.iteration}`;
}

function harness(remoteOverrides: Partial<Remote> = {}) {
  const live = new Set<string>();
  const remote = {
    environmentId: 'env-desk',
    label: 'desk',
    reason: 'least loaded',
    isFly: false,
    launch: vi.fn(async (spec: Spec) => ({ status: 201, body: { name: spec.name, cwd: ownerCwd(spec), branch: spec.branch, warnings: ['owner says hi'] } as Record<string, unknown> })),
    stop: vi.fn(async (name: string) => {
      const lane = await readRemoteLane(name);
      await writeRemoteLaneMirror(name, {
        v: 1, state: 'gone', activity: 'stopped', lastActivityAt: null, git: null, costUsd: null, ownerArchived: false,
        lastSeq: 0, lastSeenAt: lane?.facts.createdAt ?? null, unreachableSince: null, lastAssistantMessage: null, spawnError: null,
      });
    }),
    ...remoteOverrides,
  };
  const git = {
    fetchBase: vi.fn(async () => null),
    addBranchWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    addDetachedWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    applySparse: vi.fn(async () => undefined),
  };
  const deps = {
    remote,
    git,
    resolveConfig: vi.fn(async () => config()),
    resolveHarness: vi.fn(async () => 'claude-code' as const),
    isAlive: vi.fn(async (tmuxSession: string) => live.has(tmuxSession)),
    stop: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    emitCreated: vi.fn(),
    sleep: vi.fn(async () => undefined),
    homeDir: () => TEST_HOME,
    tmpRoot: join(TEST_HOME, 'tmp'),
    cpuPressure: vi.fn(async () => CPU_SATURATED),
  } satisfies Deps;
  return { deps, remote, git, live };
}

let rootCount = 0;
function root(): string {
  rootCount += 1;
  const name = `root-${rootCount}`;
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: PROJECT_PATH, workspaceId: null, projectKey: 'lexerra' });
  return name;
}

function request(parent: string, overrides: Partial<Request>): Request {
  return { parent, run: 'hotel', key: '663', role: 'builder', brief: '# Build the hex map', ...overrides };
}

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof LaneLaunchError>> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LaneLaunchError);
  return error as InstanceType<typeof LaneLaunchError>;
}

beforeEach(() => {
  mkdirSync(PROJECT_PATH, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('launchLane on another machine (PAN-4638 WI-4)', () => {
  it('launches a builder through the owner: no local row, stand-in facts, a home brief copy, no home CPU check', async () => {
    const { deps, remote, git } = harness();
    const parent = root();
    const result = await launchLane(request(parent, { key: 'b1', machine: 'desk' }), deps);

    const spec = remote.launch.mock.calls[0]![0];
    expect(spec).toMatchObject({ run: 'hotel', key: 'b1', role: 'builder', iteration: 1, branch: 'hotel/b1', base: 'origin/main', at: null, reuseCwd: null, force: false });
    expect(result).toMatchObject({
      conversation: { id: null, name: spec.name, gauntletRun: 'hotel', laneKey: 'b1', laneRole: 'builder' },
      cwd: ownerCwd(spec),
      branch: 'hotel/b1',
      iteration: 1,
      warnings: ['owner says hi'],
      machine: { environmentId: 'env-desk', label: 'desk', reason: 'least loaded' },
    });
    expect(getConversationByName(spec.name)).toBeNull();
    expect((await readRemoteLane(spec.name))?.facts).toMatchObject({ parentName: parent, cwd: ownerCwd(spec), environmentId: 'env-desk', label: 'desk' });
    expect(readFileSync(join(workerDir(`conv-${spec.name}`), 'lane-brief.md'), 'utf8')).toBe(`${spec.briefHeader}\n\n# Build the hex map\n`);
    expect(deps.cpuPressure).not.toHaveBeenCalled();
    expect(git.fetchBase).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('ac1: a remote critic of a local builder carries the builder\'s done head and leaves a stand-in', async () => {
    const { deps, remote } = harness();
    const parent = root();
    const local = harness();
    const builder = await launchLane(request(parent, { run: 'crit', key: 'c1' }), { ...local.deps, remote: undefined, cpuPressure: vi.fn(async () => ({ ...CPU_SATURATED, saturated: false })) });
    await writeWorkerReport(`conv-${builder.conversation.name}`, { body: 'done', git: { head: 'feed123', branch: 'crit/c1' } });

    const critic = await launchLane(request(parent, { run: 'crit', role: 'critic', key: undefined, for: 'c1', machine: 'desk', brief: '# Judge' }), deps);
    const spec = remote.launch.mock.calls[0]![0];
    expect(spec).toMatchObject({ role: 'critic', key: 'c1', at: 'feed123', branch: null, base: null });
    const standIn = await readRemoteLane(critic.conversation.name);
    expect(standIn?.facts).toMatchObject({ role: 'critic', criticOfName: builder.conversation.name, at: 'feed123' });
    expect(existsSync(join(remoteLanesRoot(), critic.conversation.name, 'lane.json'))).toBe(true);
  });

  it('ac2: an owner refusal answers its status and leaves no stand-in directory', async () => {
    const { deps } = harness({
      launch: vi.fn(async () => ({ status: 404, body: { code: 'project-missing', error: 'desk has no project for github.com/eltmon/lexerra' } })),
    });
    const error = await rejection(launchLane(request(root(), { key: 'b2', machine: 'desk' }), deps));
    expect(error.status).toBe(404);
    expect(error.code).toBe('project-missing');
    expect(error.message).toBe('desk has no project for github.com/eltmon/lexerra');
    const spec = deps.remote.launch.mock.calls[0]![0] as Spec;
    expect(existsSync(join(remoteLanesRoot(), spec.name))).toBe(false);
  });

  it('an unreached owner rethrows the transport error and removes the claim', async () => {
    const { deps } = harness({ launch: vi.fn(async () => { throw new Error('link offline'); }) });
    await expect(launchLane(request(root(), { key: 'b3', machine: 'desk' }), deps)).rejects.toThrow('link offline');
    const spec = deps.remote.launch.mock.calls[0]![0] as Spec;
    expect(existsSync(join(remoteLanesRoot(), spec.name))).toBe(false);
  });

  it('ac3: retries with a new name after name-taken and succeeds', async () => {
    const { deps, remote } = harness();
    remote.launch.mockResolvedValueOnce({ status: 409, body: { code: 'name-taken', error: 'name-taken: conversation x exists' } });
    const result = await launchLane(request(root(), { key: 'b4', machine: 'desk' }), deps);
    expect(remote.launch).toHaveBeenCalledTimes(2);
    const [first, second] = remote.launch.mock.calls.map((call) => call[0].name);
    expect(second).not.toBe(first);
    expect(result.conversation.name).toBe(second);
    expect(existsSync(join(remoteLanesRoot(), first!))).toBe(false);
    expect(await readRemoteLane(second!)).not.toBeNull();
  });

  it('ac4: refuses a harness that does not run on Fly machines before calling it, and lets Codex through', async () => {
    const { deps, remote } = harness({ isFly: true });
    deps.resolveHarness.mockResolvedValue('pi' as never);
    const error = await rejection(launchLane(request(root(), { key: 'b5', machine: 'fly-abc' }), deps));
    expect(error.status).toBe(400);
    expect(error.message).toBe('pi does not run on Fly machines (#4296)');
    expect(remote.launch).not.toHaveBeenCalled();

    deps.resolveHarness.mockResolvedValue('codex' as never);
    await launchLane(request(root(), { key: 'b5c', machine: 'fly-abc' }), deps);
    expect(remote.launch).toHaveBeenCalledTimes(1);
  });

  it('ac5: a live remote lane answers 409; --replace stops it through the owner first', async () => {
    const { deps, remote } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: 'b6', machine: 'desk' }), deps);

    const refused = await rejection(launchLane(request(parent, { key: 'b6', machine: 'desk' }), deps));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(`${first.conversation.name} on desk`);

    const replaced = await launchLane(request(parent, { key: 'b6', machine: 'desk', replace: true }), deps);
    expect(remote.stop).toHaveBeenCalledWith(first.conversation.name);
    expect(remote.stop.mock.invocationCallOrder[0]).toBeLessThan(remote.launch.mock.invocationCallOrder.at(-1)!);
    expect(replaced.iteration).toBe(2);
  });

  it('cuts a remote builder\'s second iteration from the first iteration\'s reported branch', async () => {
    const { deps, remote } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: 'b7', machine: 'desk' }), deps);
    await writeWorkerReport(`conv-${first.conversation.name}`, { body: 'done', git: { head: 'aaa1111', branch: 'hotel/b7-renamed' } });
    await remote.stop(first.conversation.name);

    await launchLane(request(parent, { key: 'b7', machine: 'desk' }), deps);
    expect(remote.launch.mock.calls.at(-1)![0]).toMatchObject({ iteration: 2, branch: 'hotel/b7-i2', base: 'hotel/b7-renamed' });
  });

  it('refuses --machine with --reuse, and an orchestrator on another machine', async () => {
    const { deps, remote } = harness();
    const parent = root();
    const reuse = await rejection(launchLane(request(parent, { key: 'b8', machine: 'desk', reuse: true }), deps));
    expect(reuse.status).toBe(400);
    expect(reuse.message).toBe("--reuse continues on the newest lane's machine; drop --machine");
    const orchestrator = await rejection(launchLane(request(parent, { key: 'o1', role: 'orchestrator', machine: 'desk' }), deps));
    expect(orchestrator.status).toBe(400);
    expect(orchestrator.message).toBe("orchestrator lanes run on the orchestrator's machine");
    expect(remote.launch).not.toHaveBeenCalled();
  });

  it('--reuse continues in the newest remote lane\'s directory on its machine', async () => {
    const { deps, remote } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: 'b9', machine: 'desk' }), deps);
    await remote.stop(first.conversation.name);

    const reused = await launchLane(request(parent, { key: 'b9', reuse: true }), deps);
    expect(remote.launch.mock.calls.at(-1)![0]).toMatchObject({ reuseCwd: first.cwd, iteration: 1, base: null });
    expect(reused.iteration).toBe(1);
    await remote.stop(reused.conversation.name);

    const local = harness();
    const elsewhere = await rejection(launchLane(
      request(parent, { key: 'b9', reuse: true }),
      { ...local.deps, remote: undefined, cpuPressure: vi.fn(async () => ({ ...CPU_SATURATED, saturated: false })) },
    ));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.message).toContain('ran on desk');
  });

  it('a local launch never takes a name a remote lane already holds', async () => {
    const { deps } = harness();
    const parent = root();
    const random = vi.spyOn(Math, 'random');
    try {
      random.mockReturnValueOnce(0.5);
      const remote = await launchLane(request(parent, { run: 'coll', key: 'r1', machine: 'desk' }), deps);
      // The local launch's first candidate is the remote lane's name; the next one is free.
      random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.6);
      const local = harness();
      const launched = await launchLane(
        request(parent, { run: 'coll', key: 'l1' }),
        { ...local.deps, remote: undefined, cpuPressure: vi.fn(async () => ({ ...CPU_SATURATED, saturated: false })) },
      );
      expect(launched.conversation.name).not.toBe(remote.conversation.name);
      expect(getConversationByName(launched.conversation.name)?.laneKey).toBe('l1');
    } finally {
      random.mockRestore();
    }
  });

  it('a local launch refuses with 500 when every name candidate is taken, and removes its directory', async () => {
    const { deps } = harness();
    const parent = root();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      await launchLane(request(parent, { run: 'full', key: 'r1', machine: 'desk' }), deps);
      const local = harness();
      const error = await rejection(launchLane(
        request(parent, { run: 'full', key: 'l1', role: 'play', model: 'claude-opus-5-5' }),
        { ...local.deps, remote: undefined, cpuPressure: vi.fn(async () => ({ ...CPU_SATURATED, saturated: false })) },
      ));
      expect(error.status).toBe(500);
      expect(error.message).toContain('could not allocate a free conversation name');
      expect(existsSync(join(LANES_ROOT, 'full-l1-play-i1'))).toBe(false);
    } finally {
      random.mockRestore();
    }
  });

  it('a local critic of a remote builder links it through the sidecar', async () => {
    const { deps } = harness();
    const parent = root();
    const builder = await launchLane(request(parent, { run: 'side', key: 's1', machine: 'desk' }), deps);
    const local = harness();
    const critic = await launchLane(
      request(parent, { run: 'side', role: 'critic', key: undefined, for: 's1', at: 'bbb2222', brief: '# Judge' }),
      { ...local.deps, remote: undefined, cpuPressure: vi.fn(async () => ({ ...CPU_SATURATED, saturated: false })) },
    );
    expect(critic.machine).toBeNull();
    expect(getConversationByName(critic.conversation.name)?.criticOfConversationId).toBeNull();
    expect(await readCriticLink(critic.conversation.name)).toBe(builder.conversation.name);
  });
});
