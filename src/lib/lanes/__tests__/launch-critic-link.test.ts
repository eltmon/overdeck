/**
 * PAN-4223 WI-19: the lane door links critics to builders. Same harness as
 * launch.test.ts: real conversations DB in a temp OVERDECK_HOME; injected
 * git, liveness, stop door and runtime start.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-critic-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, getConversationByName, markConversationEnded } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { workerDir } = await import('../../agents/worker/ids.js');
const { launchLane } = await import('../launch.js');
const { LaneLaunchError } = await import('../types.js');

type Deps = NonNullable<Parameters<typeof launchLane>[1]>;
type Request = Parameters<typeof launchLane>[0];

const PROJECT_PATH = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');
const MODEL = { model: 'claude-opus-5-5' };

function harness() {
  const git = {
    fetchBase: vi.fn(async () => null),
    addBranchWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    addDetachedWorktree: vi.fn(async (_project: string, path: string) => { mkdirSync(path, { recursive: true }); }),
    applySparse: vi.fn(async () => undefined),
  };
  const deps = {
    git,
    resolveConfig: vi.fn(async () => ({
      projectKey: 'lexerra',
      projectPath: PROJECT_PATH,
      lanesRoot: LANES_ROOT,
      baseRef: 'origin/main',
      sparseCheckout: null,
      roles: { builder: MODEL, critic: MODEL, verifier: MODEL, play: MODEL },
    })),
    resolveHarness: vi.fn(async () => 'claude-code' as const),
    isAlive: vi.fn(async () => false),
    stop: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    emitCreated: vi.fn(),
    sleep: vi.fn(async () => undefined),
    homeDir: () => TEST_HOME,
    tmpRoot: join(TEST_HOME, 'tmp'),
  } satisfies Deps;
  return { deps, git };
}

let roots = 0;
function root(): string {
  roots += 1;
  const name = `critic-root-${roots}`;
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: PROJECT_PATH, workspaceId: null, projectKey: 'lexerra' });
  return name;
}

function request(parent: string, overrides: Partial<Request>): Request {
  return { parent, run: 'hotel', role: 'critic', brief: '# Judge the hex map against the bar', ...overrides };
}

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof LaneLaunchError>> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LaneLaunchError);
  return error as InstanceType<typeof LaneLaunchError>;
}

/** A finished builder i1 whose done report carries `head`. */
async function builtBuilder(parent: string, key: string, head: string | null, deps: Deps, run = 'hotel') {
  const builder = await launchLane({ parent, run, key, role: 'builder', brief: '# build MARKER-BUILDER-BRIEF' }, deps);
  markConversationEnded(builder.conversation.name);
  if (head) {
    await writeWorkerReport(`conv-${builder.conversation.name}`, { body: 'MARKER-BUILDER-REPORT', git: { head, branch: `${run}/${key}` } });
  }
  return builder.conversation;
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

describe('launchLane critic link (PAN-4223 WI-19)', () => {
  it('refuses a critic without --for, --for without a builder in the run, and --for on a play lane', async () => {
    const { deps } = harness();
    const parent = root();
    expect((await rejection(launchLane(request(parent, { key: 'x', at: 'abc1234' }), deps))).message).toBe('a critic needs --for <builder key>');
    expect((await rejection(launchLane(request(parent, { for: 'ghost' }), deps))).message).toBe('no builder lane ghost in run hotel');
    await builtBuilder(parent, 'elsewhere', 'abc1234', deps, 'other');
    expect((await rejection(launchLane(request(parent, { for: 'elsewhere' }), deps))).message).toBe('no builder lane elsewhere in run hotel');
    expect((await rejection(launchLane(request(parent, { role: 'play', key: 'p', for: 'elsewhere' }), deps))).message).toBe('--for is for critic and verifier lanes');
  });

  it('refuses a --key that differs from --for', async () => {
    const { deps } = harness();
    const parent = root();
    await builtBuilder(parent, 'keyed', 'abc1234', deps);
    expect((await rejection(launchLane(request(parent, { for: 'keyed', key: 'other' }), deps))).message).toBe("a critic's --key is its builder's key (keyed)");
  });

  it('checks a critic out at the builder\'s newest done head and links the builder row', async () => {
    const { deps, git } = harness();
    const parent = root();
    const builder = await builtBuilder(parent, '663', 'deadbee', deps);
    const critic = await launchLane(request(parent, { for: '663' }), deps);
    expect(git.addDetachedWorktree).toHaveBeenLastCalledWith(PROJECT_PATH, join(LANES_ROOT, 'hotel-663-critic-i1'), 'deadbee');
    expect(getConversationByName(critic.conversation.name)).toMatchObject({ laneKey: '663', criticOfConversationName: builder.name });
  });

  it('refuses a critic when the builder iteration has no done report and no --at is given', async () => {
    const { deps } = harness();
    const parent = root();
    await builtBuilder(parent, 'unbuilt', null, deps);
    expect((await rejection(launchLane(request(parent, { for: 'unbuilt' }), deps))).message).toBe('builder unbuilt i1 has no done report; pass --at <sha>');
  });

  it('launches a verifier without --for when --at is given', async () => {
    const { deps, git } = harness();
    const result = await launchLane(request(root(), { role: 'verifier', key: 'whole-run', at: 'feed123' }), deps);
    expect(result.conversation).toMatchObject({ laneRole: 'verifier', criticOfConversationName: null });
    expect(git.addDetachedWorktree).toHaveBeenLastCalledWith(PROJECT_PATH, join(LANES_ROOT, 'hotel-whole-run-verify-i1'), 'feed123');
  });

  it('keeps the critic blind: no builder name or report text in its contract or brief', async () => {
    const { deps } = harness();
    const parent = root();
    const builder = await builtBuilder(parent, 'blind', 'cafe123', deps);
    const critic = await launchLane(request(parent, { for: 'blind' }), deps);
    const message = (deps.start.mock.calls.at(-1)?.[0] as unknown as { message: string }).message;
    const brief = readFileSync(join(workerDir(`conv-${critic.conversation.name}`), 'lane-brief.md'), 'utf8');
    for (const text of [message, brief]) {
      expect(text).not.toContain(builder.name);
      expect(text).not.toContain('MARKER-BUILDER');
    }
    expect(message).toContain('You judge commit cafe123');
  });

  it('tells builder i2 which critic verdict it answers', async () => {
    const { deps } = harness();
    const parent = root();
    await builtBuilder(parent, '664', 'beef123', deps);
    const critic = await launchLane(request(parent, { for: '664' }), deps);
    markConversationEnded(critic.conversation.name);
    await writeWorkerReport(`conv-${critic.conversation.name}`, { body: 'not yet', verdict: { value: 'NOT_YET', defects: 2, file: '/v/664.json' } });

    const i2 = await launchLane({ parent, run: 'hotel', key: '664', role: 'builder', brief: '# again' }, deps);
    expect(i2.iteration).toBe(2);
    const message = (deps.start.mock.calls.at(-1)?.[0] as unknown as { message: string }).message;
    expect(message).toContain(`This iteration answers critic c1 (conv #${critic.conversation.id}): NOT_YET. Verdict file: /v/664.json.`);
  });
});
