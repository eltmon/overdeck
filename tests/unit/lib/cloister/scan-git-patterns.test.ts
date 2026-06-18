/**
 * Tests for scanGitPatterns and GIT_PATTERNS in merge-agent.ts (PAN-653).
 *
 * Verifies that each git pattern is detected from tmux output and results
 * in an appendGitOperation call with the correct operation type and status.
 * Also tests deduplication (same line not recorded twice).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Dependency mocks (must precede all imports of merge-agent.ts) ─────────────

const mockAppendGitOperation = vi.fn();
vi.mock('../../../../src/lib/git-activity.js', () => ({
  appendGitOperation: (...args: unknown[]) => mockAppendGitOperation(...args),
  appendGitOperationSync: (...args: unknown[]) => mockAppendGitOperation(...args),
}));

const mockEmitActivityEntry = vi.fn();
const mockEmitDashboardLifecycle = vi.fn();
vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: (...args: unknown[]) => mockEmitActivityEntry(...args),
  emitActivityEntrySync: (...args: unknown[]) => mockEmitActivityEntry(...args),
  emitDashboardLifecycle: (...args: unknown[]) => mockEmitDashboardLifecycle(...args),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/paths.js', () => ({
  PANOPTICON_HOME: '/tmp/panopticon-scan-git-test',
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  capturePaneAsync: vi.fn().mockResolvedValue(''),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockReturnValue(false),
  sessionExistsSync: vi.fn().mockReturnValue(false),
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  recordWake: vi.fn(),
  getTmuxSessionName: vi.fn().mockReturnValue('specialist-merge-agent'),
  spawnEphemeralSpecialist: vi.fn().mockResolvedValue({ success: false }),
  isRunning: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
  resolveProjectFromIssueSync: vi.fn().mockReturnValue(null),
  loadProjectsConfig: vi.fn().mockReturnValue({ projects: {} }),
  loadProjectsConfigSync: vi.fn().mockReturnValue({ projects: {} }),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  runMergeValidation: vi.fn(),
  autoRevertMerge: vi.fn(),
  runQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockResolvedValue({ found: [], removed: [], errors: [] }),
}));

vi.mock('../../../../src/lib/cloister/prompts.js', () => ({
  renderPrompt: vi.fn().mockReturnValue(''),
}));

vi.mock('../../../../src/lib/git/operations.js', () => {
  class MainDivergedError extends Error {
    constructor(msg = 'diverged') { super(msg); this.name = 'MainDivergedError'; }
  }
  return {
    gitPush: vi.fn().mockResolvedValue(undefined),
    gitForcePush: vi.fn().mockResolvedValue(undefined),
    MainDivergedError,
  };
});

vi.mock('../../../../src/lib/review-status.js', () => ({
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

// ── Import under test (after all vi.mock declarations) ───────────────────────

import { scanGitPatterns, GIT_PATTERNS } from '../../../../src/lib/cloister/merge-agent.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GIT_PATTERNS regex coverage', () => {
  it.each([
    ['git push',              'push_attempt',   /git push/i],
    ['git fetch origin',      'fetch_attempt',  /git fetch/i],
    ['[rejected]',            'push_rejected',  /\[rejected\]/i],
    ['non-fast-forward',      'non_ff',         /non-fast-forward/i],
    ['force-with-lease',      'force_push_cmd', /force-with-lease/i],
    ['retrying push',         'retry',          /retrying/i],
    ['[remote rejected]',     'remote_rejected',/\[remote rejected\]/i],
    ['Everything up-to-date', 'push_noop',      /Everything up-to-date/i],
  ] as const)('pattern for "%s" maps to operation "%s"', (sample, expectedOp) => {
    const pattern = GIT_PATTERNS.find(p => p.re.test(sample));
    expect(pattern).toBeDefined();
    expect(pattern?.operation).toBe(expectedOp);
  });
});

describe('scanGitPatterns', () => {
  it('records push_attempt when output contains "git push"', () => {
    scanGitPatterns('git push origin feature/pan-653', new Set(), 'PAN-653', 'feature/pan-653');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'push_attempt',
      issueId: 'PAN-653',
      branch: 'feature/pan-653',
      status: 'success',
    }));
  });

  it('records fetch_attempt when output contains "git fetch"', () => {
    scanGitPatterns('git fetch origin', new Set(), 'PAN-10');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'fetch_attempt',
      status: 'success',
    }));
  });

  it('records non_ff as failure when output contains "non-fast-forward"', () => {
    scanGitPatterns('! [rejected] main -> main (non-fast-forward)', new Set(), 'PAN-1');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'push_rejected',
      status: 'failure',
    }));
  });

  it('records remote_rejected as failure when output contains "[remote rejected]"', () => {
    scanGitPatterns('! [remote rejected] feature/pan-1 -> feature/pan-1 (pre-receive hook declined)', new Set(), 'PAN-1');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'remote_rejected',
      status: 'failure',
    }));
  });

  it('records push_noop as success when output contains "Everything up-to-date"', () => {
    scanGitPatterns('Everything up-to-date', new Set(), 'PAN-99');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'push_noop',
      status: 'success',
    }));
  });

  it('records force_push_cmd when a line contains "force-with-lease" without a "git push" prefix', () => {
    scanGitPatterns('warning: rejected by force-with-lease protection', new Set(), 'PAN-5');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'force_push_cmd',
      status: 'success',
    }));
  });

  it('classifies "git push --force-with-lease" as force_push_cmd, not push_attempt', () => {
    // Regression: force-with-lease pattern must appear before /git push/i in GIT_PATTERNS
    // so the full command string is correctly classified as a force-push.
    scanGitPatterns('git push --force-with-lease origin main', new Set(), 'PAN-5');
    expect(mockAppendGitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'force_push_cmd',
    }));
    expect(mockAppendGitOperation).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: 'push_attempt',
    }));
  });

  it('deduplicates: same line does not produce a second appendGitOperation call', () => {
    const seen = new Set<string>();
    scanGitPatterns('git push origin main', seen, 'PAN-1');
    expect(mockAppendGitOperation).toHaveBeenCalledTimes(1);
    scanGitPatterns('git push origin main', seen, 'PAN-1');
    expect(mockAppendGitOperation).toHaveBeenCalledTimes(1); // still 1
  });

  it('only records the first matching pattern per line (no double-recording)', () => {
    // "[remote rejected]" also matches "[rejected]" pattern — only first wins
    scanGitPatterns('[rejected] (non-fast-forward)', new Set(), 'PAN-1');
    expect(mockAppendGitOperation).toHaveBeenCalledTimes(1);
  });

  it('processes multiple distinct lines independently', () => {
    const output = 'git push origin main\ngit fetch origin\nEverything up-to-date';
    scanGitPatterns(output, new Set(), 'PAN-2', 'main');
    expect(mockAppendGitOperation).toHaveBeenCalledTimes(3);
  });

  it('also emits an activity entry for each matched line', () => {
    scanGitPatterns('git push origin feature/pan-1', new Set(), 'PAN-1');
    expect(mockEmitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ship',
      issueId: 'PAN-1',
    }));
  });

  it('skips empty lines without recording', () => {
    scanGitPatterns('\n\n   \n', new Set(), 'PAN-1');
    expect(mockAppendGitOperation).not.toHaveBeenCalled();
  });

  it('skips lines that match no pattern', () => {
    scanGitPatterns('some random log output', new Set(), 'PAN-1');
    expect(mockAppendGitOperation).not.toHaveBeenCalled();
  });
});
