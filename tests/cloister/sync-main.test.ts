/**
 * Tests for syncMainIntoWorkspace and scanForConflictMarkers (PAN-242)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const realExecAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Module mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/cloister/specialists.js', () => ({
  wakeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getTmuxSessionName: vi.fn((name: string, projectKey?: string) =>
    projectKey ? `specialist-${projectKey}-${name}` : `specialist-${name}`
  ),
  isRunning: vi.fn(() => true),
  getSessionId: vi.fn(),
  recordWake: vi.fn(),
}));

// Return null so syncMainIntoWorkspace falls back to wakeSpecialist (legacy path)
vi.mock('../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockResolvedValue({ found: [], removed: [], errors: [] }),
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

  (exec as any)[kCustom] = execMock;

  return { exec, spawn: vi.fn() };
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
import { syncMainIntoWorkspace, scanForConflictMarkers } from '../../src/lib/cloister/merge-agent.js';
import { wakeSpecialist, spawnEphemeralSpecialist, getTmuxSessionName } from '../../src/lib/cloister/specialists.js';
import { cleanupStaleLocks } from '../../src/lib/git-utils.js';
import { resolveProjectFromIssue } from '../../src/lib/projects.js';

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

// ---------------------------------------------------------------------------
// syncMainIntoWorkspace tests
// ---------------------------------------------------------------------------

describe('syncMainIntoWorkspace', () => {
  const PROJECT_PATH = '/fake/workspace';
  const ISSUE_ID = 'PAN-242';

  beforeEach(() => {
    vi.clearAllMocks();
    (cleanupStaleLocks as any).mockResolvedValue({ found: [], removed: [], errors: [] });
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

  describe('conflict handling — agent delegation', () => {
    it('wakes merge-agent specialist when git merge has conflicts', async () => {
      const wakeSpecialistMock = vi.mocked(wakeSpecialist);
      wakeSpecialistMock.mockResolvedValue({ success: true, message: 'woken' } as any);

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
        // tmux output with MERGE_RESULT after first poll
        if (cmd.includes('tmux capture-pane')) return { stdout: 'MERGE_RESULT: SUCCESS\nRESOLVED_FILES: src/foo.ts\nNOTES: resolved\n', stderr: '' };
        if (cmd.includes('git diff --check')) return { stdout: '', stderr: '' };
        if (cmd.includes('git diff --name-only ORIG_HEAD HEAD')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git log ORIG_HEAD..HEAD --oneline')) return { stdout: 'merge123 Merge branch main\n', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(wakeSpecialistMock).toHaveBeenCalledWith(
        'merge-agent',
        expect.stringContaining('PAN-242'),
        expect.objectContaining({ issueId: ISSUE_ID }),
      );
      expect(result.success).toBe(true);
      expect(result.changedFiles).toContain('src/foo.ts');
    });

    it('aborts merge and returns failure when agent reports MERGE_RESULT: FAILURE', async () => {
      const wakeSpecialistMock = vi.mocked(wakeSpecialist);
      wakeSpecialistMock.mockResolvedValue({ success: true, message: 'woken' } as any);

      let mergeAbortCalled = false;
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT');
          err.stdout = 'CONFLICT (content): Merge conflict in src/foo.ts\n';
          err.stderr = '';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git branch --show-current')) return { stdout: 'feature/pan-242\n', stderr: '' };
        if (cmd.includes('tmux capture-pane')) return {
          stdout: 'MERGE_RESULT: FAILURE\nFAILED_FILES: src/foo.ts\nREASON: Irreconcilable conflict\n',
          stderr: '',
        };
        if (cmd.includes('git merge --abort')) { mergeAbortCalled = true; return { stdout: '', stderr: '' }; }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.conflictFiles).toContain('src/foo.ts');
      expect(result.reason).toMatch(/irreconcilable|could not resolve/i);
      expect(mergeAbortCalled).toBe(true);
    });

    it('returns failure when wakeSpecialist fails, and aborts the merge', async () => {
      const wakeSpecialistMock = vi.mocked(wakeSpecialist);
      wakeSpecialistMock.mockResolvedValue({ success: false, message: 'specialist not available' } as any);

      let mergeAbortCalled = false;
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT');
          err.stdout = 'CONFLICT (content): Merge conflict in src/foo.ts\n';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git branch --show-current')) return { stdout: 'feature/pan-242\n', stderr: '' };
        if (cmd.includes('git merge --abort')) { mergeAbortCalled = true; return { stdout: '', stderr: '' }; }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/Failed to wake/i);
      expect(mergeAbortCalled).toBe(true);
    });

    it('returns failure when agent succeeds but conflict markers remain', async () => {
      const wakeSpecialistMock = vi.mocked(wakeSpecialist);
      wakeSpecialistMock.mockResolvedValue({ success: true, message: 'woken' } as any);

      let mergeAbortCalled = false;
      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT');
          err.stdout = 'CONFLICT\n';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git branch --show-current')) return { stdout: 'feature/pan-242\n', stderr: '' };
        if (cmd.includes('tmux capture-pane')) return { stdout: 'MERGE_RESULT: SUCCESS\nRESOLVED_FILES: src/foo.ts\n', stderr: '' };
        // git diff --check reports remaining markers
        if (cmd.includes('git diff --check')) return {
          stdout: 'src/foo.ts:15: leftover conflict marker\n',
          stderr: '',
        };
        if (cmd.includes('git merge --abort')) { mergeAbortCalled = true; return { stdout: '', stderr: '' }; }
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/conflict marker/i);
      expect(mergeAbortCalled).toBe(true);
    });

    it('uses spawnEphemeralSpecialist when resolveProjectFromIssue returns a project key', async () => {
      // Override the projects mock to return a project key for this test
      vi.mocked(resolveProjectFromIssue).mockReturnValueOnce({ projectKey: 'pan' } as any);
      const spawnMock = vi.mocked(spawnEphemeralSpecialist);
      spawnMock.mockResolvedValueOnce({ success: true, message: 'spawned', tmuxSession: 'specialist-pan-merge-agent' });

      execMock.mockImplementation(async (cmd: string) => {
        if (cmd.includes('git status --porcelain')) return { stdout: '', stderr: '' };
        if (cmd.includes('git fetch origin main')) return { stdout: '', stderr: '' };
        if (cmd.includes('git merge origin/main')) {
          const err: any = new Error('CONFLICT');
          err.stdout = 'CONFLICT (content): Merge conflict in src/foo.ts\n';
          throw err;
        }
        if (cmd.includes('git diff --name-only --diff-filter=U')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git branch --show-current')) return { stdout: 'feature/pan-242\n', stderr: '' };
        if (cmd.includes('tmux capture-pane')) return { stdout: 'MERGE_RESULT: SUCCESS\nRESOLVED_FILES: src/foo.ts\n', stderr: '' };
        if (cmd.includes('git diff --check')) return { stdout: '', stderr: '' };
        if (cmd.includes('git diff --name-only ORIG_HEAD HEAD')) return { stdout: 'src/foo.ts\n', stderr: '' };
        if (cmd.includes('git log ORIG_HEAD..HEAD --oneline')) return { stdout: 'abc123 merge commit\n', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

      expect(spawnMock).toHaveBeenCalledWith(
        'pan',
        'merge-agent',
        expect.objectContaining({ issueId: ISSUE_ID, promptOverride: expect.stringContaining('PAN-242') }),
      );
      expect(vi.mocked(wakeSpecialist)).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('git lock cleanup', () => {
    it('blocks when git processes are running (detected via lock cleanup)', async () => {
      (cleanupStaleLocks as any).mockResolvedValue({
        found: ['/fake/.git/index.lock'],
        removed: [],
        errors: [{ file: '/fake/.git/index.lock', error: 'Git processes are running - not safe to remove locks' }],
      });

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
