import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('child_process', () => childProcessMocks);

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testRoot: string;
let workspacePath: string;

describe('queryBeadsForIssuePromise', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    testRoot = await mkdtemp(join(tmpdir(), 'pan-beads-query-'));
    workspacePath = join(testRoot, 'workspace');
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    process.env.OVERDECK_HOME = join(testRoot, 'home');
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('retries transient bd lock failures before returning canonical data', async () => {
    vi.useFakeTimers();
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('database is locked'), '', 'database is locked');
    });
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(null, { stdout: JSON.stringify([{ id: 'overdeck-1', title: 'PAN-1094: Task', status: 'open', labels: ['pan-1094'] }]) }, '');
    });
    const { queryBeadsForIssuePromise } = await import('../../../src/lib/beads-query.js');

    await expect(queryBeadsForIssuePromise(workspacePath, 'PAN-1094', {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    })).resolves.toEqual({
      beads: [{ id: 'overdeck-1', title: 'PAN-1094: Task', status: 'open', labels: ['pan-1094'] }],
    });
    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });

  it('marks the read stale after exhausted transient bd failures', async () => {
    vi.useFakeTimers();
    childProcessMocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('database is locked'), '', 'database is locked');
    });
    const { queryBeadsForIssuePromise } = await import('../../../src/lib/beads-query.js');
    const { BdTransientFailure } = await import('../../../src/lib/bd-process-lock.js');

    const fallback = { id: 'jsonl-1', title: 'PAN-1094: JSONL task', status: 'open', labels: ['pan-1094'] };
    writeFileSync(join(workspacePath, '.beads', 'issues.jsonl'), JSON.stringify(fallback) + '\n');

    const result = await queryBeadsForIssuePromise(workspacePath, 'PAN-1094', {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    });
    expect(result.beads).toEqual([]);
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/stale, not empty/);
    expect(result.transientFailure).toBeInstanceOf(BdTransientFailure);
    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });

  it('returns ready open beads for multiple issue labels from one bd snapshot', async () => {
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(null, {
        stdout: JSON.stringify([
          { id: 'workspace-a', title: 'PAN-1094: first', status: 'open', labels: ['pan-1094'], dependency_count: 0 },
          { id: 'workspace-b', title: 'PAN-1095: second', status: 'open', labels: ['workspace:pan-1095'], dependency_count: 0 },
          { id: 'workspace-c', title: 'PAN-1094: blocked', status: 'open', labels: ['pan-1094'], dependency_count: 1 },
          { id: 'workspace-d', title: 'PAN-1095: closed', status: 'closed', labels: ['pan-1095'], dependency_count: 0 },
          { id: 'workspace-e', title: 'PAN-0000: other', status: 'open', labels: ['pan-0000'], dependency_count: 0 },
        ]),
      }, '');
    });
    const { queryReadyBeadsByIssueLabelsPromise } = await import('../../../src/lib/beads-query.js');

    const result = await queryReadyBeadsByIssueLabelsPromise(workspacePath, ['PAN-1094', 'PAN-1095']);

    expect(result.byIssue['pan-1094']).toEqual([
      expect.objectContaining({ id: 'workspace-a', title: 'PAN-1094: first' }),
    ]);
    expect(result.byIssue['pan-1095']).toEqual([
      expect.objectContaining({ id: 'workspace-b', title: 'PAN-1095: second' }),
    ]);
    expect(childProcessMocks.execFile).toHaveBeenCalledOnce();
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      'bd',
      ['list', '--json', '--status', 'all', '--limit', '0'],
      expect.objectContaining({ cwd: workspacePath }),
      expect.any(Function),
    );
  });

  it('marks ready beads stale after exhausted transient bd failures', async () => {
    vi.useFakeTimers();
    childProcessMocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('database is locked'), '', 'database is locked');
    });
    writeFileSync(join(workspacePath, '.beads', 'issues.jsonl'), [
      JSON.stringify({ id: 'jsonl-1', title: 'PAN-1094: ready', status: 'open', labels: ['pan-1094'], dependency_count: 0 }),
      JSON.stringify({ id: 'jsonl-2', title: 'PAN-1094: blocked', status: 'open', labels: ['pan-1094'], dependency_count: 1 }),
    ].join('\n') + '\n');
    const { queryReadyBeadsByIssueLabelsPromise } = await import('../../../src/lib/beads-query.js');
    const { BdTransientFailure } = await import('../../../src/lib/bd-process-lock.js');

    const result = await queryReadyBeadsByIssueLabelsPromise(workspacePath, ['PAN-1094'], {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    });

    expect(result.byIssue['pan-1094']).toEqual([]);
    expect(result.stale).toBe(true);
    expect(result.transientFailure).toBeInstanceOf(BdTransientFailure);
    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });

  it('fails a patrol read stale within its bounded lock budget', async () => {
    vi.useFakeTimers();
    const { bdProcessLockPath } = await import('../../../src/lib/bd-process-lock.js');
    const { queryReadyBeadsByIssueLabelsPromise } = await import('../../../src/lib/beads-query.js');
    const path = await bdProcessLockPath(workspacePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ pid: process.pid, ts: Date.now(), caller: 'create beads from vBRIEF' })}\n`);
    writeFileSync(join(workspacePath, '.beads', 'issues.jsonl'), [
      JSON.stringify({ id: 'jsonl-1', title: 'PAN-1094: ready', status: 'open', labels: ['pan-1094'], dependency_count: 0 }),
      JSON.stringify({ id: 'jsonl-2', title: 'PAN-1094: blocked', status: 'open', labels: ['pan-1094'], dependency_count: 1 }),
    ].join('\n') + '\n');

    const resultPromise = queryReadyBeadsByIssueLabelsPromise(workspacePath, ['PAN-1094'], {
      acquisitionTimeoutMs: 50,
      pollIntervalMs: 10,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
      maxAttempts: 1,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.byIssue['pan-1094']).toEqual([]);
    expect(result.stale).toBe(true);
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it('resolves feature workspaces to one project-level beads query root', async () => {
    const { resolveBeadsQueryRoot } = await import('../../../src/lib/beads-query.js');

    expect(resolveBeadsQueryRoot('/repo/workspaces/feature-pan-2261')).toBe('/repo');
    expect(resolveBeadsQueryRoot('/repo')).toBe('/repo');
  });
});
