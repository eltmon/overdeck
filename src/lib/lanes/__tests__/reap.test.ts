/**
 * PAN-4223 WI-7: reapLane against a real temp repo with real worktrees and a
 * real conversations DB (temp OVERDECK_HOME). The process list, liveness and
 * the archive are injected; git argv is recorded.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const TEST_HOME = join(tmpdir(), `lane-reap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = join(TEST_HOME, '.overdeck');
mkdirSync(process.env.OVERDECK_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, markConversationEnded } = await import('../../overdeck/conversations.js');
const { workerDir } = await import('../../agents/worker/ids.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { reapLane, LaneReapError } = await import('../reap.js');

const execFileAsync = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Lane Test',
  GIT_AUTHOR_EMAIL: 'lane@test.invalid',
  GIT_COMMITTER_NAME: 'Lane Test',
  GIT_COMMITTER_EMAIL: 'lane@test.invalid',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const PROJECT = join(TEST_HOME, 'Projects', 'lexerra');
const LANES_ROOT = join(TEST_HOME, 'Projects', 'lexerra-lanes');
const REMOTE = join(TEST_HOME, 'lexerra.git');

mkdirSync(PROJECT, { recursive: true });
mkdirSync(LANES_ROOT, { recursive: true });
git(TEST_HOME, 'init', '-q', '--bare', '-b', 'main', REMOTE);
git(PROJECT, 'init', '-q', '-b', 'main');
git(PROJECT, 'remote', 'add', 'origin', REMOTE);
writeFileSync(join(PROJECT, 'tracked.txt'), 'original\n');
git(PROJECT, 'add', '.');
git(PROJECT, 'commit', '-q', '-m', 'first');
git(PROJECT, 'push', '-q', '-u', 'origin', 'main');
createConversation({ name: 'reap-root', tmuxSession: 'conv-reap-root', cwd: PROJECT, workspaceId: null, projectKey: 'lexerra' });

const CONFIG = {
  projectKey: 'lexerra',
  projectPath: PROJECT,
  lanesRoot: LANES_ROOT,
  baseRef: 'origin/main',
  sparseCheckout: null,
  roles: {},
};

/** A builder lane on its own worktree and branch, pushed with upstream. */
function builderLane(key: string): { name: string; cwd: string } {
  const cwd = join(LANES_ROOT, `hotel-${key}`);
  git(PROJECT, 'worktree', 'add', '-q', '-b', `hotel/${key}`, cwd, 'main');
  git(cwd, 'push', '-q', '-u', 'origin', `hotel/${key}`);
  const name = `lane-${key}`;
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, workspaceId: null, projectKey: 'lexerra', parentName: 'reap-root', lane: { run: 'hotel', key, role: 'builder' } });
  markConversationEnded(name);
  return { name, cwd };
}

function harness(overrides: { failApply?: boolean; archiveAnswer?: { body: unknown; status?: number } } = {}) {
  const events: string[] = [];
  const argv: string[][] = [];
  const gitRunner = vi.fn(async (args: string[], cwd: string) => {
    argv.push(args);
    events.push(`git ${args.slice(0, 2).join(' ')}`);
    if (overrides.failApply && args[0] === 'apply') throw new Error('apply --check failed');
    const { stdout } = await execFileAsync('git', args, { cwd, env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  });
  const archiveByName = vi.fn(async () => {
    events.push('archive');
    return overrides.archiveAnswer ?? { body: { success: true } };
  });
  const deps = {
    archive: { stopConversationRuntime: vi.fn(async () => undefined), invalidateFavoritesCache: vi.fn(), cleanupConversationAttachments: vi.fn(async () => undefined) },
    archiveByName,
    git: gitRunner,
    isAlive: vi.fn(async () => false),
    stop: vi.fn(async () => undefined),
    processesUnder: vi.fn(async () => [] as Array<{ pid: string; command: string }>),
    resolveConfig: vi.fn(async () => CONFIG),
    sleep: vi.fn(async () => undefined),
  };
  return { deps, events, argv, archiveByName };
}

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof LaneReapError>> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LaneReapError);
  return error as InstanceType<typeof LaneReapError>;
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('reapLane (PAN-4223 WI-7)', () => {
  it('removes the worktree without --force, archives last, and keeps the brief and reports', async () => {
    const { name, cwd } = builderLane('clean');
    const dir = workerDir(`conv-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lane-brief.md'), '# brief\n');
    await writeWorkerReport(`conv-${name}`, { body: 'done' });
    const { deps, events, argv, archiveByName } = harness();

    const result = await reapLane(name, {}, deps);
    expect(result).toEqual({ removed: true, archived: true, parkedPatch: null, warnings: [] });
    expect(existsSync(cwd)).toBe(false);
    expect(git(PROJECT, 'branch', '--list', 'hotel/clean')).toContain('hotel/clean');
    expect(archiveByName).toHaveBeenCalledTimes(1);
    expect(archiveByName).toHaveBeenCalledWith(name, deps.archive);
    expect(events.indexOf('archive')).toBeGreaterThan(events.indexOf('git worktree remove'));
    expect(argv.flat()).not.toContain('--force');
    expect(existsSync(join(dir, 'lane-brief.md'))).toBe(true);
    expect(existsSync(join(dir, 'reports', '0001.json'))).toBe(true);
  });

  it('stops a live lane first, and refuses when the stop does not take', async () => {
    const live = builderLane('live');
    const first = harness();
    first.deps.isAlive.mockResolvedValueOnce(true).mockResolvedValue(false);
    await reapLane(live.name, {}, first.deps);
    expect(first.deps.stop).toHaveBeenCalledTimes(1);

    const stuck = builderLane('stuck');
    const second = harness();
    second.deps.isAlive.mockResolvedValue(true);
    const error = await rejection(reapLane(stuck.name, {}, second.deps));
    expect(error.status).toBe(409);
    expect(error.message).toContain('stop did not take');
    expect(second.archiveByName).not.toHaveBeenCalled();
    expect(existsSync(stuck.cwd)).toBe(true);
  });

  it('refuses while a process runs in the directory, and never archives', async () => {
    const { name, cwd } = builderLane('pid');
    const { deps, archiveByName } = harness();
    deps.processesUnder.mockResolvedValue([{ pid: '4242', command: 'node vite' }]);
    const error = await rejection(reapLane(name, {}, deps));
    expect(error.status).toBe(409);
    expect(error.message).toContain('4242 node vite');
    expect(existsSync(cwd)).toBe(true);
    expect(archiveByName).not.toHaveBeenCalled();
  });

  it('refuses a dirty tree without park, and a directory outside the lanes root', async () => {
    const dirty = builderLane('dirty');
    writeFileSync(join(dirty.cwd, 'tracked.txt'), 'changed\n');
    const first = harness();
    const error = await rejection(reapLane(dirty.name, {}, first.deps));
    expect(error).toMatchObject({ status: 409, message: expect.stringContaining('pass --park') });
    expect(first.archiveByName).not.toHaveBeenCalled();

    const outside = join(TEST_HOME, 'outside');
    mkdirSync(outside, { recursive: true });
    createConversation({ name: 'lane-outside', tmuxSession: 'conv-lane-outside', cwd: outside, workspaceId: null, projectKey: 'lexerra', parentName: 'reap-root', lane: { run: 'hotel', key: 'outside', role: 'builder' } });
    const second = harness();
    const outsideError = await rejection(reapLane('lane-outside', {}, second.deps));
    expect(outsideError.status).toBe(400);
    expect(existsSync(outside)).toBe(true);
    expect(second.deps.git).not.toHaveBeenCalled();
    expect(second.archiveByName).not.toHaveBeenCalled();
  });

  it('parks a modified tracked file and an untracked file in a patch that reapplies onto HEAD', async () => {
    const { name, cwd } = builderLane('park');
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
    writeFileSync(join(cwd, 'new.txt'), 'untracked\n');
    const { deps } = harness();

    const result = await reapLane(name, { park: true }, deps);
    expect(result.removed).toBe(true);
    expect(existsSync(cwd)).toBe(false);
    expect(result.parkedPatch).toMatch(/parked-.*\.patch$/);

    const fresh = join(TEST_HOME, 'fresh-park');
    git(PROJECT, 'worktree', 'add', '-q', '--detach', fresh, 'hotel/park');
    git(fresh, 'apply', result.parkedPatch!);
    expect(readFileSync(join(fresh, 'tracked.txt'), 'utf8')).toBe('changed\n');
    expect(readFileSync(join(fresh, 'new.txt'), 'utf8')).toBe('untracked\n');
  });

  it('discards nothing when the parked patch does not verify', async () => {
    const { name, cwd } = builderLane('noverify');
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
    const { deps, argv, archiveByName } = harness({ failApply: true });
    const error = await rejection(reapLane(name, { park: true }, deps));
    expect(error.status).toBe(500);
    expect(argv.map((args) => args[0])).not.toContain('reset');
    expect(argv.map((args) => args[0])).not.toContain('clean');
    expect(readFileSync(join(cwd, 'tracked.txt'), 'utf8')).toBe('changed\n');
    expect(archiveByName).not.toHaveBeenCalled();
  });

  it('keep skips the archive; already-archived counts; a failed archive warns and still reports removed', async () => {
    const kept = builderLane('keep');
    const keep = harness();
    expect(await reapLane(kept.name, { keep: true }, keep.deps)).toMatchObject({ removed: true, archived: false, warnings: [] });
    expect(keep.archiveByName).not.toHaveBeenCalled();

    const already = builderLane('already');
    const answered = harness({ archiveAnswer: { body: { error: 'Conversation is already archived' }, status: 400 } });
    expect(await reapLane(already.name, {}, answered.deps)).toMatchObject({ archived: true, warnings: [] });

    const failing = builderLane('failing');
    const failed = harness({ archiveAnswer: { body: { error: 'Internal server error' }, status: 500 } });
    const result = await reapLane(failing.name, {}, failed.deps);
    expect(result).toMatchObject({ removed: true, archived: false });
    expect(result.warnings).toEqual([expect.stringMatching(/^reaped, but archiving failed: Internal server error; archive conv \d+ from the Command Deck$/)]);
  });

  it('warns about a branch without upstream and keeps it', async () => {
    const { name, cwd } = builderLane('local');
    git(cwd, 'checkout', '-q', '-b', 'hotel/local-only');
    const { deps } = harness();
    const result = await reapLane(name, {}, deps);
    expect(result.warnings).toEqual(['branch hotel/local-only has no upstream; its commits stay on the local branch']);
    expect(git(PROJECT, 'branch', '--list', 'hotel/local-only')).toContain('hotel/local-only');
  });
});
