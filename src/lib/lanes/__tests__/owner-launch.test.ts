/**
 * PAN-4638 WI-2: the owner side of a remote lane. Real conversations DB in a
 * temp OVERDECK_HOME; injected git, runtime start, CPU check and config.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `owner-launch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, getConversationByName } = await import('../../overdeck/conversations.js');
const { conversationStartedBy } = await import('../../overdeck/conversation-provenance.js');
const { workerDir } = await import('../../agents/worker/ids.js');
const { launchOwnedLane } = await import('../owner-launch.js');
const { LaneLaunchError } = await import('../types.js');

type Deps = NonNullable<Parameters<typeof launchOwnedLane>[2]>;
type Spec = Parameters<typeof launchOwnedLane>[0];
type LaneConfig = Awaited<ReturnType<NonNullable<Deps['resolveConfig']>>>;

const PROJECT_PATH = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');
const TMP_ROOT = join(TEST_HOME, 'tmp');
const CONTEXT = { projectKey: 'lex-owner', startedBy: 'env-home' };

const CPU_CALM = { saturated: false, signal: 'psi-some-avg60' as const, reading: 10, threshold: 50, psiSomeAvg10: 8 };
const CPU_SATURATED = { saturated: true, signal: 'psi-some-avg60' as const, reading: 55, threshold: 50, psiSomeAvg10: 60 };

function config(): LaneConfig {
  return {
    projectKey: 'lex-owner',
    projectPath: PROJECT_PATH,
    lanesRoot: LANES_ROOT,
    baseRef: 'main',
    sparseCheckout: null,
    roles: {},
  };
}

function harness(commits: readonly string[] = ['main', 'abc1234']) {
  const git = {
    fetchBase: vi.fn(async (): Promise<string | null> => null),
    addBranchWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    addDetachedWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    applySparse: vi.fn(async () => undefined),
    commitExists: vi.fn(async (_project: string, ref: string) => commits.includes(ref)),
  };
  const deps = {
    git,
    resolveConfig: vi.fn(async () => config()),
    resolveHarness: vi.fn(async () => 'claude-code' as const),
    isAlive: vi.fn(async () => false),
    start: vi.fn(async () => undefined),
    emitCreated: vi.fn(),
    homeDir: () => TEST_HOME,
    tmpRoot: TMP_ROOT,
    cpuPressure: vi.fn(async () => CPU_CALM),
  } satisfies Deps;
  return { deps, git };
}

let count = 0;
function spec(overrides: Partial<Spec> = {}): Spec {
  count += 1;
  return {
    name: `20261101-${String(1000 + count)}`,
    run: 'hotel',
    key: `k${count}`,
    role: 'builder',
    iteration: 1,
    brief: '# Build the hex map',
    briefHeader: `<!-- lane hotel/k${count} builder i1; parent orch; source inline -->`,
    title: `hotel k${count} · builder`,
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    effort: 'high',
    branch: `hotel/k${count}`,
    base: null,
    at: null,
    reuseCwd: null,
    answering: null,
    force: false,
    ...overrides,
  };
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

describe('launchOwnedLane (PAN-4638 WI-2)', () => {
  it('launches a builder: branch worktree, brief, lane row with no parent, provenance, contract', async () => {
    const { deps, git } = harness();
    const lane = spec();
    const result = await launchOwnedLane(lane, CONTEXT, deps);

    const target = join(LANES_ROOT, `hotel-${lane.key}`);
    expect(result).toEqual({ name: lane.name, cwd: target, branch: lane.branch, warnings: [] });
    expect(deps.resolveConfig).toHaveBeenCalledWith('lex-owner');
    expect(git.addBranchWorktree).toHaveBeenCalledWith(PROJECT_PATH, target, lane.branch, 'main');

    expect(getConversationByName(lane.name)).toMatchObject({
      cwd: target,
      title: lane.title,
      titleSource: 'manual',
      gauntletRun: 'hotel',
      laneKey: lane.key,
      laneRole: 'builder',
      projectKey: 'lex-owner',
      parentConversationId: null,
      criticOfConversationId: null,
    });
    expect(conversationStartedBy(lane.name)).toBe('env-home');

    const briefPath = join(workerDir(`conv-${lane.name}`), 'lane-brief.md');
    expect(readFileSync(briefPath, 'utf8')).toBe(`${lane.briefHeader}\n\n# Build the hex map\n`);
    const started = deps.start.mock.calls[0]?.[0] as unknown as { message: string; cwd: string };
    expect(started.cwd).toBe(target);
    expect(started.message).toContain(`Read ${briefPath} FIRST`);
    expect(started.message).toContain(`Your branch is ${lane.branch}.`);
  });

  it('answers 409 name-taken for an existing name and leaves that row alone', async () => {
    const { deps, git } = harness();
    createConversation({ name: '20261101-9001', tmuxSession: 'conv-20261101-9001', cwd: PROJECT_PATH, workspaceId: null });
    const error = await rejection(launchOwnedLane(spec({ name: '20261101-9001' }), CONTEXT, deps));
    expect(error.status).toBe(409);
    expect(error.code).toBe('name-taken');
    expect(getConversationByName('20261101-9001')).toMatchObject({ cwd: PROJECT_PATH, laneKey: null });
    expect(git.addBranchWorktree).not.toHaveBeenCalled();
  });

  it('refuses a critic or verifier with no commit to judge before creating anything', async () => {
    const { deps, git } = harness();
    for (const role of ['critic', 'verifier'] as const) {
      const lane = spec({ role, branch: null, at: null });
      const error = await rejection(launchOwnedLane(lane, CONTEXT, deps));
      expect(error.status).toBe(400);
      expect(error.message).toBe(`a ${role} lane needs the commit it judges`);
      expect(getConversationByName(lane.name)).toBeNull();
    }
    expect(git.fetchBase).not.toHaveBeenCalled();
  });

  it('refuses an orchestrator lane with 400', async () => {
    const { deps } = harness();
    const error = await rejection(launchOwnedLane(spec({ role: 'orchestrator', branch: null }), CONTEXT, deps));
    expect(error.status).toBe(400);
    expect(error.message).toBe("orchestrator lanes run on the orchestrator's machine");
  });

  it('answers 429 while the CPU is saturated and launches with force', async () => {
    const { deps } = harness();
    deps.cpuPressure.mockResolvedValue(CPU_SATURATED);
    const error = await rejection(launchOwnedLane(spec(), CONTEXT, deps));
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/^cpu-saturated: psi-some-avg60 55 is at or above 50/);

    const forced = spec({ force: true });
    await launchOwnedLane(forced, CONTEXT, deps);
    expect(getConversationByName(forced.name)?.laneKey).toBe(forced.key);
  });

  it('answers 400 when the harness is not allowed on the owner', async () => {
    const { deps } = harness();
    deps.resolveHarness.mockRejectedValue(new Error('harness codex is not allowed for claude-opus-5-5'));
    const error = await rejection(launchOwnedLane(spec(), CONTEXT, deps));
    expect(error.status).toBe(400);
    expect(error.message).toContain('codex is not allowed');
  });

  it('answers 400 when the judged commit is not on origin after the fetch, naming a fetch failure', async () => {
    const { deps, git } = harness();
    git.fetchBase.mockResolvedValue('git fetch origin failed in /x');
    const critic = spec({ role: 'critic', branch: null, at: 'def5678' });
    const error = await rejection(launchOwnedLane(critic, CONTEXT, deps));
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      'commit def5678 is not on origin; the builder must push before a critic on another machine judges it (git fetch origin failed in /x)',
    );
    expect(git.addDetachedWorktree).not.toHaveBeenCalled();
    expect(existsSync(join(LANES_ROOT, `hotel-${critic.key}-critic-i1`))).toBe(false);
    expect(getConversationByName(critic.name)).toBeNull();
  });

  it('launches a critic detached at a commit it has', async () => {
    const { deps, git } = harness();
    const critic = spec({ role: 'critic', branch: null, at: 'abc1234', iteration: 2 });
    const result = await launchOwnedLane(critic, CONTEXT, deps);
    expect(result.cwd).toBe(join(LANES_ROOT, `hotel-${critic.key}-critic-i2`));
    expect(git.addDetachedWorktree).toHaveBeenCalledWith(PROJECT_PATH, result.cwd, 'abc1234');
    expect(result.branch).toBeNull();
  });

  it('cuts the branch from origin/<base> when the base is not a local ref, and refuses a base on neither', async () => {
    const { deps, git } = harness(['origin/release']);
    const lane = spec({ base: 'release' });
    await launchOwnedLane(lane, CONTEXT, deps);
    expect(git.addBranchWorktree).toHaveBeenCalledWith(PROJECT_PATH, join(LANES_ROOT, `hotel-${lane.key}`), lane.branch, 'origin/release');

    const error = await rejection(launchOwnedLane(spec({ base: 'missing' }), CONTEXT, deps));
    expect(error.status).toBe(400);
    expect(error.message).toBe('base missing is not on origin');
  });

  it('refuses a reuse directory outside the lanes root', async () => {
    const { deps } = harness();
    const error = await rejection(launchOwnedLane(spec({ reuseCwd: PROJECT_PATH }), CONTEXT, deps));
    expect(error.status).toBe(400);
    expect(error.message).toContain('is not inside the lanes root');
  });
});

describe('createConversation remote-launch options (PAN-4638 D-4638-2/3)', () => {
  it('creates a lane without a parent only for a remote launch, and refuses a critic link there', () => {
    expect(() => createConversation({
      name: '20261101-8001', tmuxSession: 'conv-20261101-8001', cwd: PROJECT_PATH, workspaceId: null, lane: { run: 'r', key: 'k', role: 'builder' },
    })).toThrow('a lane needs a parent');
    expect(() => createConversation({
      name: '20261101-8002',
      tmuxSession: 'conv-20261101-8002',
      cwd: PROJECT_PATH,
      workspaceId: null,
      lane: { run: 'r', key: 'k', role: 'critic', criticOfName: '20261101-8001' },
      remoteLaunch: true,
    })).toThrow('a remote-launched lane links no builder');
  });

  it('refuses an existing name instead of vacating it', () => {
    createConversation({ name: '20261101-8003', tmuxSession: 'conv-20261101-8003', cwd: PROJECT_PATH, workspaceId: null });
    expect(() => createConversation({
      name: '20261101-8003', tmuxSession: 'conv-20261101-8003', cwd: LANES_ROOT, workspaceId: null, refuseExistingName: true,
    })).toThrow('conversation 20261101-8003 exists');
    expect(getConversationByName('20261101-8003')?.cwd).toBe(PROJECT_PATH);
  });
});
