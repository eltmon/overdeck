import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock, spawn: vi.fn(() => ({ unref: vi.fn(), pid: 1234 })) };
});

vi.mock('../specialists.js', () => ({
  getSessionId: vi.fn(),
  recordWake: vi.fn(),
  getTmuxSessionName: vi.fn(() => 'merge-session'),
  wakeSpecialist: vi.fn(async () => ({ success: true })),
  spawnEphemeralSpecialist: vi.fn(async () => ({ success: true })),
  isRunning: vi.fn(async () => true),
}));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityTts: vi.fn(), emitDashboardLifecycle: vi.fn() }));
vi.mock('../../tmux.js', () => ({ capturePaneAsync: vi.fn(async () => ''), listSessionNamesAsync: vi.fn(async () => []), sendKeysAsync: vi.fn(async () => {}), sessionExists: vi.fn(() => false), sessionExistsAsync: vi.fn(async () => false), killSession: vi.fn() }));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon' })), loadProjectsConfig: vi.fn(() => ({ projects: {} })) }));
vi.mock('../validation.js', () => ({
  runMergeValidation: vi.fn(async () => ({ valid: true, skipped: true })),
  autoRevertMerge: vi.fn(async () => true),
  runQualityGates: vi.fn(async () => []),
}));
vi.mock('../../git-utils.js', () => ({ cleanupStaleLocks: vi.fn(async () => ({ found: [], removed: [], errors: [] })) }));
vi.mock('../prompts.js', () => ({ renderPrompt: vi.fn(() => 'merge prompt') }));
vi.mock('../../git/operations.js', () => ({ gitPush: vi.fn(), gitForcePush: vi.fn(), MainDivergedError: class MainDivergedError extends Error {} }));
vi.mock('../../review-status.js', () => ({ markWorkspaceStuck: vi.fn() }));
vi.mock('../../git-activity.js', () => ({ appendGitOperation: vi.fn() }));
vi.mock('../../stashes.js', () => ({
  buildStashMessage: vi.fn(() => 'pre-merge:PAN-1:2026-04-27T14:15:16Z'),
  createNamedStash: vi.fn(async () => 'stash@{0}'),
  popStash: vi.fn(async () => {}),
}));
vi.mock('../../tracker-utils.js', () => ({ resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })) }));
vi.mock('../../paths.js', () => ({ PANOPTICON_HOME: '/tmp/pan', AGENTS_DIR: '/tmp/agents', PROJECT_PRDS_ACTIVE_SUBDIR: 'active' }));
vi.mock('../../tldr-daemon.js', () => ({ getTldrDaemonService: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
});

import { spawnMergeAgentForBranches } from '../merge-agent.js';
import { createNamedStash, popStash } from '../../stashes.js';

describe('merge-agent pre-merge stash lifecycle', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as any;
    }) as typeof setTimeout);
    let headReads = 0;
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd.startsWith('git ls-remote --heads origin feature/pan-1')) return callback(null, { stdout: 'abc123\trefs/heads/feature/pan-1\n', stderr: '' });
      if (cmd.startsWith('git fetch origin feature/pan-1 main')) return callback(null, { stdout: '', stderr: '' });
      if (cmd.includes('git merge-base --is-ancestor')) return callback(Object.assign(new Error('not ancestor'), { code: 1 }));
      if (cmd === 'git rev-parse HEAD') {
        headReads += 1;
        return callback(null, { stdout: headReads === 1 ? 'head-before\n' : 'head-after\n', stderr: '' });
      }
      if (cmd === 'git status --porcelain') return callback(null, { stdout: ' M file.ts\n', stderr: '' });
      if (cmd === 'git branch --show-current') return callback(null, { stdout: 'main\n', stderr: '' });
      if (cmd === 'git fetch origin main') return callback(null, { stdout: '', stderr: '' });
      if (cmd === 'git rev-parse origin/main') return callback(null, { stdout: 'head-after\n', stderr: '' });
      callback(null, { stdout: 'head-after\n', stderr: '' });
    });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it('creates and restores pre-merge stash on successful completion', async () => {
    const result = await spawnMergeAgentForBranches('/tmp/workspace', 'feature/pan-1', 'main', 'PAN-1', { skipDoneReport: true });

    expect(result.success).toBe(true);
    expect(createNamedStash).toHaveBeenCalledWith('/tmp/workspace', 'pre-merge:PAN-1:2026-04-27T14:15:16Z', true);
    expect(popStash).toHaveBeenCalledWith('/tmp/workspace', 'stash@{0}');
  });
});
