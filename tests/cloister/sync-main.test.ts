/**
 * Tests for syncMainIntoWorkspace and scanForConflictMarkers (PAN-242)
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const spawnRunMock = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn((name: string, projectKey?: string) =>
    projectKey ? `specialist-${projectKey}-${name}` : `specialist-${name}`
  ),
  isRunning: vi.fn(() => true),
}));

vi.mock('../../src/lib/agents.js', () => ({
  spawnRun: spawnRunMock,
}));

vi.mock('../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
  resolveProjectFromIssueSync: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockReturnValue(Effect.succeed({ found: [], removed: [], errors: [] })),
}));

// Hoist tmux mock so factory can reference it
const tmuxCapturePaneAsyncMock = vi.hoisted(() => vi.fn<[string], Promise<string>>().mockResolvedValue(''));

vi.mock('../../src/lib/tmux.js', () => ({
  capturePaneAsync: tmuxCapturePaneAsyncMock,
  sessionExists: vi.fn().mockReturnValue(true),
  sessionExistsSync: vi.fn().mockReturnValue(true),
  sessionExistsAsync: vi.fn().mockResolvedValue(true),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
  listSessionNamesAsync: vi.fn().mockResolvedValue(['specialist-merge-agent']),
  buildTmuxCommandString: vi.fn().mockReturnValue(''),
  createSessionAsync: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  listPaneValues: vi.fn().mockReturnValue([]),
  listPaneValuesAsync: vi.fn().mockResolvedValue([]),
}));

// Hoist the exec mock so it is available inside vi.mock factory
const execMock = vi.hoisted(() =>
  vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>()
    .mockResolvedValue({ stdout: '', stderr: '' })
);

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout }) => callback(null, stdout, ''))
      .catch((err) => callback(err, '', ''));
  }

  function execFile(file: string, argsOrOptionsOrCb: any, optionsOrCb?: any, maybeCallback?: any) {
    const callback = typeof argsOrOptionsOrCb === 'function'
      ? argsOrOptionsOrCb
      : typeof optionsOrCb === 'function'
        ? optionsOrCb
        : maybeCallback;
    const args = Array.isArray(argsOrOptionsOrCb) ? argsOrOptionsOrCb.join(' ') : '';
    const cmd = args ? `${file} ${args}` : file;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : typeof argsOrOptionsOrCb === 'object' ? argsOrOptionsOrCb : undefined)
      .then(({ stdout }) => callback(null, stdout, ''))
      .catch((err) => callback(err, '', ''));
  }

  (exec as any)[kCustom] = execMock;
  // execFile's promisified form is called as (file, args, opts). Translate
  // that to the {cmd, opts} shape execMock expects, so test mocks that match
  // on `cmd.includes('tmux capture-pane')` still resolve correctly for the
  // async tmux helpers in src/lib/tmux.ts.
  (execFile as any)[kCustom] = (file: string, args?: string[], opts?: any) => {
    const cmd = Array.isArray(args) && args.length > 0 ? `${file} ${args.join(' ')}` : file;
    return execMock(cmd, opts);
  };

  return { exec, execFile, spawn: vi.fn() };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(), // suppress activity log writes
    readFileSync: vi.fn((path: string, ...args: any[]) => {
      // Return a minimal sync-main.md template (with frontmatter) so renderPrompt works
      if (String(path).includes('sync-main.md')) {
        return '---\nname: sync-main\ndescription: Sync main into workspace\nrequires:\n  - projectPath\n  - workspaceBranch\n  - issueId\n  - conflictFiles\noptional: []\n---\nSYNC TASK for {{issueId}} in {{projectPath}} branch {{workspaceBranch}}\nConflicts:\n{{{conflictFiles}}}';
      }
      return actual.readFileSync(path, ...args);
    }),
    existsSync: vi.fn((path: string) => {
      if (String(path).includes('sync-main.md')) return true;
      return actual.existsSync(path);
    }),
  };
});

// Import under test (after mocks)
import {
  isSyncMainMainPreferredPath,
  scanForConflictMarkers,
  syncMainIntoWorkspace,
} from '../../src/lib/cloister/merge-agent.js';
import { cleanupStaleLocks } from '../../src/lib/git-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockExecSequence(responses: Record<string, { stdout: string; stderr?: string; throws?: boolean }>) {
  execMock.mockImplementation(async (cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (response.throws) {
          const err: any = new Error(`Command failed: ${cmd}`);
          err.stdout = response.stdout || '';
          err.stderr = response.stderr || '';
          throw err;
        }
        return { stdout: response.stdout, stderr: response.stderr || '' };
      }
    }
    return { stdout: '', stderr: '' };
  });
}

// ---------------------------------------------------------------------------
// scanForConflictMarkers tests (unit — uses mocked exec)
// ---------------------------------------------------------------------------

describe('scanForConflictMarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('returns empty array when git diff --check reports no conflicts', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    const result = await scanForConflictMarkers('/some/path');
    expect(result).toEqual([]);
  });

  it('returns files with leftover conflict markers', async () => {
    execMock.mockResolvedValue({
      stdout: [
        'src/foo.ts:12: leftover conflict marker',
        'src/bar.ts:45: leftover conflict marker',
        'src/foo.ts:20: leftover conflict marker',
      ].join('\n'),
      stderr: '',
    });
    const result = await scanForConflictMarkers('/some/path');
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('src/bar.ts');
    // deduplicates
    expect(result).toHaveLength(2);
  });

  it('returns empty array when exec throws (non-fatal)', async () => {
    execMock.mockRejectedValue(new Error('not a git repo'));
    const result = await scanForConflictMarkers('/some/path');
    expect(result).toEqual([]);
  });
});

describe('isSyncMainMainPreferredPath', () => {
  it('matches only pipeline-owned sync state paths', () => {
    expect(isSyncMainMainPreferredPath('.pan/continues/PAN-1.vbrief.json')).toBe(true);
    expect(isSyncMainMainPreferredPath('.pan/specs/PAN-1.vbrief.json')).toBe(true);
    expect(isSyncMainMainPreferredPath('.beads/issues.jsonl')).toBe(true);

    expect(isSyncMainMainPreferredPath('.pan/continue.json')).toBe(false);
    expect(isSyncMainMainPreferredPath('.pan/spec.vbrief.json')).toBe(false);
    expect(isSyncMainMainPreferredPath('src/foo.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncMainIntoWorkspace tests
// ---------------------------------------------------------------------------

describe('syncMainIntoWorkspace', () => {
  const PROJECT_PATH = '/fake/workspace';
  const ISSUE_ID = 'PAN-242';

  beforeEach(() => {
    vi.clearAllMocks();
    (cleanupStaleLocks as any).mockReturnValue(Effect.succeed({ found: [], removed: [], errors: [] }));
  });

  describe('pre-flight: uncommitted changes', () => {
    it('blocks and returns failure when workspace has uncommitted changes', async () => {
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) {
          return { stdout: 'M src/foo.ts\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/uncommitted changes/i);
      // Must not have attempted a fetch
      expect(execMock).not.toHaveBeenCalledWith(
        expect.stringContaining('git fetch'),
        expect.anything(),
      );
    });

    it('proceeds when workspace is clean', async () => {
      mockExecSequence({
        'git status --porcelain': { stdout: '' },
        'git fetch origin main': { stdout: '' },
        'git merge origin/main': { stdout: 'Already up to date.' },
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBe(true);
    });
  });

  describe('already up to date', () => {
    it('returns alreadyUpToDate: true when git merge says "Already up to date"', async () => {
      mockExecSequence({
        'git status --porcelain': { stdout: '' },
        'git fetch origin main': { stdout: '' },
        'git merge origin/main': { stdout: 'Already up to date.\n' },
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBe(true);
      expect(result.commitCount).toBeUndefined();
    });

    it('also handles "Already up-to-date" (hyphenated variant)', async () => {
      mockExecSequence({
        'git status --porcelain': { stdout: '' },
        'git fetch origin main': { stdout: '' },
        'git merge origin/main': { stdout: 'Already up-to-date.\n' },
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBe(true);
    });
  });

  describe('clean merge (no conflicts)', () => {
    it('returns success with commit count and changed files', async () => {
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) return { stdout: 'Updating abc..def\nFast-forward\n src/api.ts | 5 +++++\n', stderr: '' };
        if (cmd.includes('git diff --name-only ORIG_HEAD HEAD')) return { stdout: 'src/api.ts\nsrc/config.ts\n', stderr: '' };
        if (cmd.includes('git log ORIG_HEAD..HEAD --oneline')) return { stdout: 'abc1234 fix: patch auth\ndef5678 fix: update deps\n', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBeUndefined();
      expect(result.commitCount).toBe(2);
      expect(result.changedFiles).toEqual(['src/api.ts', 'src/config.ts']);
    });

    it('returns success with zero stats when diff commands fail (non-fatal)', async () => {
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) return { stdout: 'Updating abc..def\nFast-forward\n', stderr: '' };
        // Simulate diff/log commands failing
        if (cmd.includes('ORIG_HEAD')) {
          const err: any = new Error('ORIG_HEAD not found');
          throw err;
        }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      // Stats fall back gracefully
      expect(result.changedFiles).toEqual([]);
      expect(result.commitCount).toBe(0);
    });
  });

  describe('fetch failure', () => {
    it('returns failure when git fetch fails', async () => {
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) {
          const err: any = new Error('Could not resolve host: github.com');
          throw err;
        }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/Failed to fetch/i);
    });
  });

  describe('conflict handling — operator-resolved (PAN-1531)', () => {
    it('auto-resolves pipeline-owned conflicts with origin/main', async () => {
      let conflictScanCount = 0;
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT (content): Merge conflict in .beads/issues.jsonl');
          err.stdout = [
            'Auto-merging .beads/issues.jsonl',
            'CONFLICT (content): Merge conflict in .beads/issues.jsonl',
            'Auto-merging .pan/continues/PAN-1.vbrief.json',
            'CONFLICT (content): Merge conflict in .pan/continues/PAN-1.vbrief.json',
            '',
          ].join('\n');
          err.stderr = '';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) {
          conflictScanCount += 1;
          return {
            stdout: conflictScanCount === 1
              ? '.beads/issues.jsonl\n.pan/continues/PAN-1.vbrief.json\n'
              : '',
            stderr: '',
          };
        }
        if (cmd.includes('git rm -r --quiet --ignore-unmatch -- .beads')) return { stdout: '', stderr: '' };
        if (cmd.includes('git rm -r --quiet --ignore-unmatch -- .pan/continues')) return { stdout: '', stderr: '' };
        if (cmd.includes('git rm -r --quiet --ignore-unmatch -- .pan/specs')) return { stdout: '', stderr: '' };
        if (cmd.includes('git checkout origin/main -- .beads')) return { stdout: '', stderr: '' };
        if (cmd.includes('git checkout origin/main -- .pan/continues')) return { stdout: '', stderr: '' };
        if (cmd.includes('git checkout origin/main -- .pan/specs')) return { stdout: '', stderr: '' };
        if (cmd.includes('git add -A -- .beads')) return { stdout: '', stderr: '' };
        if (cmd.includes('git add -A -- .pan/continues')) return { stdout: '', stderr: '' };
        if (cmd.includes('git add -A -- .pan/specs')) return { stdout: '', stderr: '' };
        if (cmd.includes('git commit --no-edit')) return { stdout: '[feature abc123] Merge remote-tracking branch origin/main\n', stderr: '' };
        if (cmd.includes('git diff --name-only ORIG_HEAD HEAD')) return { stdout: '.beads/issues.jsonl\n.pan/continues/PAN-1.vbrief.json\n', stderr: '' };
        if (cmd.includes('git log ORIG_HEAD..HEAD --oneline')) return { stdout: 'abc1234 Merge remote-tracking branch origin/main\n', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(true);
      expect(result.conflictFiles).toBeUndefined();
      expect(result.changedFiles).toEqual(['.beads/issues.jsonl', '.pan/continues/PAN-1.vbrief.json']);
      expect(result.commitCount).toBe(1);
      expect(execMock).not.toHaveBeenCalledWith(
        expect.stringContaining('git merge --abort'),
        expect.anything(),
      );
    });

    it('returns failure with conflict files when git merge has conflicts', async () => {
      let mergeAbortCalled = false;
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT (content): Merge conflict in src/foo.ts');
          err.stdout = 'Auto-merging src/foo.ts\nCONFLICT (content): Merge conflict in src/foo.ts\n';
          err.stderr = '';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git branch --show-current')) return { stdout: 'feature/pan-242\n', stderr: '' };
        if (cmd.includes('git merge --abort')) { mergeAbortCalled = true; return { stdout: '', stderr: '' }; }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      // Ship role no longer involved — merge aborted, conflict surfaced to operator.
      expect(spawnRunMock).not.toHaveBeenCalledWith(ISSUE_ID, 'ship', expect.anything());
      expect(result.success).toBe(false);
      expect(result.conflictFiles).toContain('src/foo.ts');
      expect(result.reason).toMatch(/conflict/i);
      expect(mergeAbortCalled).toBe(true);
    });
  });

  describe('git lock cleanup', () => {
    it('blocks when git processes are running (detected via lock cleanup)', async () => {
      (cleanupStaleLocks as any).mockReturnValue(Effect.succeed({
        found: ['/fake/.git/index.lock'],
        removed: [],
        errors: [{ file: '/fake/.git/index.lock', error: 'Git processes are running - not safe to remove locks' }],
      }));

      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/git processes are still running/i);
    });
  });
});
