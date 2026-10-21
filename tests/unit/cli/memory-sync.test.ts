import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSyncOutcome,
  memorySyncCommand,
  runOperatorMemorySyncStep,
  type MemorySyncDeps,
} from '../../../src/cli/commands/memory-sync.js';
import type { OperatorMemorySyncOutcome, OperatorMemorySyncStatus } from '../../../src/lib/memory/facts/operator-sync.js';

const DIR = '/op/.overdeck/context/memory';

function synced(overrides: Partial<Extract<OperatorMemorySyncOutcome, { status: 'synced' }>> = {}): OperatorMemorySyncOutcome {
  return { status: 'synced', dir: DIR, committed: false, pulled: [], pushed: false, conflicts: [], heldBack: [], ...overrides };
}

const STATUS: OperatorMemorySyncStatus = {
  configured: true,
  dir: DIR,
  remote: 'https://github.com/o/memory.git',
  lastCommit: { sha: 'abcdef1234567890', date: '2026-10-21T00:00:00Z', subject: 'memory: sync from alpha' },
  ahead: 1,
  behind: 2,
  uncommitted: 3,
  conflicts: ['shared-conflict-beta'],
};

describe('pan memory sync (PAN-4578 W7)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitCodes = [];
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCodes.push(code ?? 0);
      throw new Error(`exit(${code ?? 0})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function deps(overrides: Partial<MemorySyncDeps> = {}): MemorySyncDeps {
    return {
      sync: vi.fn(async () => synced()),
      setup: vi.fn(async () => ({ migrated: [], kept: [], outcome: synced() })),
      status: vi.fn(async () => STATUS),
      ...overrides,
    };
  }

  const output = () => logSpy.mock.calls.flat().join('\n');

  it('exits 1 with the setup hint when not configured', async () => {
    await expect(
      memorySyncCommand({}, deps({ sync: async () => ({ status: 'not-configured', dir: DIR }) })),
    ).rejects.toThrow('exit(1)');
    expect(exitCodes).toEqual([1]);
    expect(output()).toContain('Operator memory is not synced. Run pan memory sync --setup <git-url> with a private repository.');
  });

  it('exits 0 and prints the conflict line for a synced outcome with one conflict', async () => {
    await memorySyncCommand({}, deps({
      sync: async () => synced({ pulled: ['shared.md'], pushed: true, conflicts: ['shared-conflict-beta'] }),
    }));
    expect(exitCodes).toEqual([]);
    expect(output()).toContain('✓ Operator memory synced (1 pulled, pushed)');
    expect(output()).toContain(
      'conflict: kept the remote shared; your version is shared-conflict-beta; ' +
      'resolve with pan memory edit --user shared and pan memory retire --user shared-conflict-beta',
    );
  });

  it('prints held-back files and nothing to push', () => {
    const { lines, ok } = formatSyncOutcome(synced({ heldBack: [{ path: 'gpu.md', reason: 'machine-specific path' }] }));
    expect(ok).toBe(true);
    expect(lines).toEqual([
      expect.stringContaining('✓ Operator memory synced (0 pulled, nothing to push)'),
      expect.stringContaining('held back gpu.md: machine-specific path; it stays on this machine'),
    ]);
  });

  it('exits 1 for offline', async () => {
    await expect(memorySyncCommand({}, deps({
      sync: async () => ({ status: 'offline', dir: DIR, error: 'fetch failed: x', committed: true, heldBack: [] }),
    }))).rejects.toThrow('exit(1)');
    expect(output()).toContain(
      'Operator memory sync is offline: fetch failed: x; local changes stay committed here and push on the next sync.',
    );
  });

  it('exits 1 for failed', async () => {
    await expect(memorySyncCommand({}, deps({
      sync: async () => ({ status: 'failed', dir: DIR, error: 'boom' }),
    }))).rejects.toThrow('exit(1)');
    expect(output()).toContain('Operator memory sync failed: boom');
  });

  it('--setup and --status together exit 1', async () => {
    const d = deps();
    await expect(memorySyncCommand({ setup: 'git@github.com:o/m.git', status: true }, d)).rejects.toThrow('exit(1)');
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--setup and --status are mutually exclusive');
    expect(d.setup).not.toHaveBeenCalled();
    expect(d.status).not.toHaveBeenCalled();
  });

  it('--json prints parseable JSON', async () => {
    const outcome = synced({ pulled: ['a.md'] });
    await memorySyncCommand({ json: true }, deps({ sync: async () => outcome }));
    expect(JSON.parse(output())).toEqual(outcome);

    logSpy.mockClear();
    await memorySyncCommand({ status: true, json: true }, deps());
    expect(JSON.parse(output())).toEqual(STATUS);
  });

  it('--setup prints moved and kept facts and exits 0 on synced', async () => {
    await memorySyncCommand({ setup: 'git@github.com:o/m.git' }, deps({
      setup: async () => ({
        migrated: [{ id: 'gpu', to: '/op/.overdeck/context/machine-memory/gpu.md' }],
        kept: ['paths'],
        outcome: synced({ pushed: true }),
      }),
    }));
    expect(exitCodes).toEqual([]);
    expect(output()).toContain('moved gpu to the machine store: /op/.overdeck/context/machine-memory/gpu.md');
    expect(output()).toContain('kept paths in the operator store');
  });

  it('--setup exits 1 when setup throws or its outcome is not synced', async () => {
    await expect(memorySyncCommand({ setup: 'x' }, deps({
      setup: async () => {
        throw new Error('cannot reach x: nope');
      },
    }))).rejects.toThrow('exit(1)');
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('cannot reach x: nope');

    await expect(memorySyncCommand({ setup: 'x' }, deps({
      setup: async () => ({ migrated: [], kept: [], outcome: { status: 'offline', dir: DIR, error: 'e', committed: false, heldBack: [] } }),
    }))).rejects.toThrow('exit(1)');
    expect(exitCodes).toEqual([1, 1]);
  });

  it('--status prints the redacted remote, counts and conflicts, and exits 0', async () => {
    await memorySyncCommand({ status: true }, deps());
    expect(exitCodes).toEqual([]);
    expect(output()).toContain(`Operator memory: synced with https://github.com/o/memory.git (${DIR})`);
    expect(output()).toContain('Last commit: abcdef1 2026-10-21T00:00:00Z memory: sync from alpha');
    expect(output()).toContain('1/2');
    expect(output()).toContain('Uncommitted changes: 3');
    expect(output()).toContain('Conflict copies: shared-conflict-beta');
  });

  it('runOperatorMemorySyncStep prints nothing when not configured', async () => {
    const sync = vi.fn(async () => synced());
    const lines: string[] = [];
    await runOperatorMemorySyncStep({ isSynced: () => false, sync, log: (line) => lines.push(line), spinner: false });
    expect(sync).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('runOperatorMemorySyncStep prints the outcome and never throws', async () => {
    const lines: string[] = [];
    await runOperatorMemorySyncStep({
      isSynced: () => true,
      sync: async () => ({ status: 'failed', dir: DIR, error: 'boom' }),
      log: (line) => lines.push(line),
      spinner: false,
    });
    expect(lines).toEqual([expect.stringContaining('Operator memory sync failed: boom')]);
    expect(exitCodes).toEqual([]);
  });
});
