/**
 * PAN-4223 WI-3: the lane door core. Real conversations DB in a temp
 * OVERDECK_HOME; injected git, liveness, stop door, runtime start and sleep.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-launch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, getConversationByName, markConversationEnded } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { workerDir } = await import('../../agents/worker/ids.js');
const { laneConfigFor } = await import('../config.js');
const { launchLane } = await import('../launch.js');
const { LaneLaunchError } = await import('../types.js');

type Deps = NonNullable<Parameters<typeof launchLane>[1]>;
type Request = Parameters<typeof launchLane>[0];
type LaneConfig = Awaited<ReturnType<NonNullable<Deps['resolveConfig']>>>;

const PROJECT_PATH = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');
const TMP_ROOT = join(TEST_HOME, 'tmp');

function config(overrides: Partial<LaneConfig> = {}): LaneConfig {
  return {
    projectKey: 'lexerra',
    projectPath: PROJECT_PATH,
    lanesRoot: LANES_ROOT,
    baseRef: 'origin/main',
    sparseCheckout: null,
    roles: { builder: { model: 'stealth/space-bunny-alpha' }, critic: { model: 'claude-opus-5-5', effort: 'high' } },
    ...overrides,
  };
}

function harness(laneConfig: LaneConfig = config()) {
  const live = new Set<string>();
  const git = {
    fetchBase: vi.fn(async () => null),
    addBranchWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    addDetachedWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    applySparse: vi.fn(async () => undefined),
  };
  const stop = vi.fn(async (conv: { name: string; tmuxSession: string }) => {
    live.delete(conv.tmuxSession);
    markConversationEnded(conv.name);
  });
  const deps = {
    git,
    resolveConfig: vi.fn(async () => laneConfig),
    resolveHarness: vi.fn(async () => 'claude-code' as const),
    isAlive: vi.fn(async (tmuxSession: string) => live.has(tmuxSession)),
    stop,
    start: vi.fn(async () => undefined),
    emitCreated: vi.fn(),
    sleep: vi.fn(async () => undefined),
    homeDir: () => TEST_HOME,
    tmpRoot: TMP_ROOT,
  } satisfies Deps;
  return { deps, git, live, stop };
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
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('launchLane (PAN-4223 WI-3)', () => {
  it('launches a builder: worktree on <run>/<key> from origin/main, brief once, lane columns, manual title, contract', async () => {
    const { deps, git } = harness();
    const parent = root();
    const result = await launchLane(request(parent, { key: '663', briefSource: '/briefs/663.md' }), deps);

    const target = join(LANES_ROOT, 'hotel-663');
    expect(result).toMatchObject({ cwd: target, branch: 'hotel/663', iteration: 1, warnings: [] });
    expect(git.fetchBase).toHaveBeenCalledWith(PROJECT_PATH);
    expect(git.addBranchWorktree).toHaveBeenCalledWith(PROJECT_PATH, target, 'hotel/663', 'origin/main');

    const row = getConversationByName(result.conversation.name);
    expect(row).toMatchObject({
      cwd: target,
      title: 'hotel 663 · builder',
      titleSource: 'manual',
      model: 'stealth/space-bunny-alpha',
      parentConversationName: parent,
      gauntletRun: 'hotel',
      laneKey: '663',
      laneRole: 'builder',
      projectKey: 'lexerra',
      bareContext: false,
    });

    const briefPath = join(workerDir(`conv-${result.conversation.name}`), 'lane-brief.md');
    expect(readFileSync(briefPath, 'utf8')).toBe(
      `<!-- lane hotel/663 builder i1; parent ${parent}; source /briefs/663.md -->\n\n# Build the hex map\n`,
    );

    expect(deps.start).toHaveBeenCalledTimes(1);
    const started = deps.start.mock.calls[0]?.[0] as unknown as { message: string; cwd: string };
    expect(started.cwd).toBe(target);
    expect(started.message).toContain(`Read ${briefPath} FIRST`);
    expect(started.message).toContain('Your branch is hotel/663.');
    expect(deps.emitCreated).toHaveBeenCalledWith(result.conversation.name);
  });

  it('applies sparse-checkout patterns to a new builder worktree', async () => {
    const { deps, git } = harness(config({ sparseCheckout: ['/*', '!/assets/*'] }));
    const result = await launchLane(request(root(), { key: 'sparse' }), deps);
    expect(git.applySparse).toHaveBeenCalledWith(result.cwd, ['/*', '!/assets/*']);
  });

  it('resolves the parent by numeric id and by conv-<name>', async () => {
    const { deps } = harness();
    const parent = root();
    const parentRow = getConversationByName(parent)!;
    const byId = await launchLane(request(String(parentRow.id), { key: 'by-id' }), deps);
    const byTmux = await launchLane(request(`conv-${parent}`, { key: 'by-tmux' }), deps);
    expect(byId.conversation.parentConversationName).toBe(parent);
    expect(byTmux.conversation.parentConversationName).toBe(parent);
    expect((await rejection(launchLane(request('no-such-parent', { key: 'nope' }), deps))).status).toBe(404);
  });

  it('refuses a critic without --at and a critic launched from a lane; detaches a critic at --at', async () => {
    const { deps, git } = harness();
    const parent = root();
    const noAt = await rejection(launchLane(request(parent, { role: 'critic', key: 'crit-1' }), deps));
    expect(noAt.status).toBe(400);

    const builder = await launchLane(request(parent, { key: 'crit-1' }), deps);
    const fromLane = await rejection(launchLane(request(builder.conversation.name, { role: 'critic', key: 'crit-1', at: 'abc1234', run: undefined }), deps));
    expect(fromLane.status).toBe(400);
    expect(fromLane.message).toContain('root conversation');

    const critic = await launchLane(request(parent, { role: 'critic', key: 'crit-1', at: 'abc1234' }), deps);
    const target = join(LANES_ROOT, 'hotel-crit-1-critic-i1');
    expect(critic).toMatchObject({ cwd: target, branch: null, iteration: 1 });
    expect(git.addDetachedWorktree).toHaveBeenCalledWith(PROJECT_PATH, target, 'abc1234');
    const started = deps.start.mock.calls.at(-1)?.[0] as unknown as { message: string; effort?: string };
    expect(started.message).toContain('You judge commit abc1234');
    expect(started.effort).toBe('high');
  });

  it('judges the effective launcher of a successor (D21, FR-30)', async () => {
    const { deps } = harness(config({ roles: { builder: { model: 'm1' }, critic: { model: 'm2' }, orchestrator: { model: 'm3' } } }));
    const parent = root();
    const orch = await launchLane(request(parent, { role: 'orchestrator', run: 'succ', key: 'north' }), deps);
    expect(orch.cwd).toBe(join(LANES_ROOT, 'succ-north-orch'));

    const successor = 'succ-of-orch';
    createConversation({ name: successor, tmuxSession: `conv-${successor}`, cwd: PROJECT_PATH, workspaceId: null, projectKey: 'lexerra', parentName: orch.conversation.name });

    const builder = await launchLane(request(successor, { run: undefined, key: 'n1' }), deps);
    expect(builder.conversation).toMatchObject({ gauntletRun: 'succ', parentConversationName: successor });

    const critic = await rejection(launchLane(request(successor, { run: undefined, role: 'critic', key: 'n1', at: 'abc1234' }), deps));
    expect(critic.status).toBe(400);

    const rootSuccessor = 'succ-of-root';
    createConversation({ name: rootSuccessor, tmuxSession: `conv-${rootSuccessor}`, cwd: PROJECT_PATH, workspaceId: null, projectKey: 'lexerra', parentName: parent });
    const rootCritic = await launchLane(request(rootSuccessor, { run: 'succ', role: 'critic', key: 'n1', at: 'abc1234' }), deps);
    expect(rootCritic.conversation).toMatchObject({ laneRole: 'critic', parentConversationName: rootSuccessor });
  });

  it('launches play in a plain directory with bare context and no CLAUDE.md', async () => {
    const { deps, git } = harness(config({ roles: { play: { model: 'claude-opus-5-5' } } }));
    const result = await launchLane(request(root(), { role: 'play', key: 'cold' }), deps);
    expect(result.cwd).toBe(join(LANES_ROOT, 'hotel-cold-play-i1'));
    expect(existsSync(result.cwd)).toBe(true);
    expect(git.fetchBase).not.toHaveBeenCalled();
    expect(git.addBranchWorktree).not.toHaveBeenCalled();
    expect(git.addDetachedWorktree).not.toHaveBeenCalled();
    expect(result.conversation).toMatchObject({ bareContext: true, skipClaudeMd: true });
  });

  it('refuses a second builder while the first is live, and --replace stops it and counts a new iteration', async () => {
    const { deps, live, stop } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: 'dup' }), deps);
    live.add(first.conversation.tmuxSession);

    const refused = await rejection(launchLane(request(parent, { key: 'dup' }), deps));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain(`#${first.conversation.id}`);

    const replaced = await launchLane(request(parent, { key: 'dup', replace: true }), deps);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.calls[0]?.[0]).toMatchObject({ name: first.conversation.name });
    expect(getConversationByName(first.conversation.name)?.status).toBe('ended');
    expect(replaced).toMatchObject({ iteration: 2, cwd: join(LANES_ROOT, 'hotel-dup-i2'), branch: 'hotel/dup-i2' });
  });

  it('refuses --replace when the old lane does not stop within 30 s', async () => {
    const { deps, live } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: 'stuck' }), deps);
    live.add(first.conversation.tmuxSession);
    deps.stop.mockImplementation(async () => undefined);

    const refused = await rejection(launchLane(request(parent, { key: 'stuck', replace: true }), deps));
    expect(refused.status).toBe(409);
    expect(refused.message).toContain('did not stop');
    expect(deps.sleep).toHaveBeenCalledTimes(30);
  });

  it('refuses an existing target without --reuse; --reuse continues in it without git', async () => {
    const { deps, git } = harness();
    const parent = root();
    mkdirSync(join(LANES_ROOT, 'hotel-exists'), { recursive: true });
    const exists = await rejection(launchLane(request(parent, { key: 'exists' }), deps));
    expect(exists.status).toBe(409);
    expect(exists.message).toContain('--reuse');

    const first = await launchLane(request(parent, { key: 'again' }), deps);
    markConversationEnded(first.conversation.name);
    git.addBranchWorktree.mockClear();
    const reused = await launchLane(request(parent, { key: 'again', reuse: true }), deps);
    expect(git.addBranchWorktree).not.toHaveBeenCalled();
    expect(reused).toMatchObject({ cwd: first.cwd, iteration: 1, branch: 'hotel/again' });
  });

  it('cuts builder iteration 2 from the previous iteration branch', async () => {
    const { deps, git } = harness();
    const parent = root();
    const first = await launchLane(request(parent, { key: '664' }), deps);
    markConversationEnded(first.conversation.name);
    await writeWorkerReport(`conv-${first.conversation.name}`, { body: 'done', git: { head: 'abc1234', branch: 'hotel/664' } });

    const second = await launchLane(request(parent, { key: '664' }), deps);
    const target = join(LANES_ROOT, 'hotel-664-i2');
    expect(second).toMatchObject({ cwd: target, branch: 'hotel/664-i2', iteration: 2 });
    expect(git.addBranchWorktree).toHaveBeenLastCalledWith(PROJECT_PATH, target, 'hotel/664-i2', 'hotel/664');
    expect(second.conversation.title).toBe('hotel 664 · builder i2');
  });

  it('refuses effort xhigh, a lanes root under /tmp or equal to the project, and a missing model', async () => {
    const parent = root();
    const xhigh = await rejection(launchLane(request(parent, { key: 'eff', effort: 'xhigh' }), harness().deps));
    expect(xhigh).toMatchObject({ status: 400, message: 'effort must be low, medium or high' });

    const underTmp = await rejection(launchLane(request(parent, { key: 'tmp' }), harness(config({ lanesRoot: join(TMP_ROOT, 'lanes') })).deps));
    expect(underTmp.status).toBe(400);
    expect(underTmp.message).toContain('must not be under');

    const sameAsProject = await rejection(launchLane(request(parent, { key: 'same' }), harness(config({ lanesRoot: PROJECT_PATH })).deps));
    expect(sameAsProject.status).toBe(400);
    expect(sameAsProject.message).toContain('project checkout');

    const noModel = await rejection(launchLane(request(parent, { role: 'verifier', key: 'nomodel', at: 'abc1234' }), harness().deps));
    expect(noModel).toMatchObject({
      status: 400,
      message: 'no model for role verifier: pass --model or set projects.lexerra.gauntlet.roles.verifier.model',
    });
  });

  it('serializes concurrent launches of one (run, key, role): one succeeds, one gets 409', async () => {
    const { deps } = harness();
    const parent = root();
    const results = await Promise.allSettled([
      launchLane(request(parent, { key: 'race' }), deps),
      launchLane(request(parent, { key: 'race' }), deps),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: 409 });
  });
});

describe('laneConfigFor', () => {
  it('defaults the lanes root to a sibling <project>-lanes directory and the base to origin/main', () => {
    const resolved = laneConfigFor('lexerra', { name: 'Lexerra', path: '/home/u/Projects/lexerra' });
    expect(resolved).toMatchObject({ lanesRoot: '/home/u/Projects/lexerra-lanes', baseRef: 'origin/main', sparseCheckout: null, roles: {} });
  });

  it('uses the workspace default branch and rejects an invalid gauntlet block', () => {
    const resolved = laneConfigFor('lexerra', { name: 'Lexerra', path: '/p/lexerra', workspace: { default_branch: 'trunk' } });
    expect(resolved.baseRef).toBe('origin/trunk');
    expect(() => laneConfigFor('lexerra', { name: 'Lexerra', path: '/p/lexerra', gauntlet: { lanes_root: 'rel' } })).toThrow(/lanes_root/);
  });
});
