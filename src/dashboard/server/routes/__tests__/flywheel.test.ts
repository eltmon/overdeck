/**
 * Tests for flywheel route helpers and metrics computation (PAN-709)
 *
 * Tests computeFlywheelMetrics (pure function) and readNonArchivedRetroFiles
 * (async helper) directly rather than through HTTP to keep tests fast and
 * independent of the Effect HTTP stack.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Mocks (before any import from the module under test)
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

vi.mock('../../../../lib/cloister/flywheel-daemon.js', () => ({
  getFlywheelDaemonStatus: vi.fn().mockReturnValue({
    isRunning: false,
    config: { autonomous: true, quiet_hours: '22:00-08:00', trigger_interval_minutes: 30, full_cycle_interval_hours: 24, backoff_on_active_session: true, awaiting_merge_notify_threshold: 5 },
    lastSynthesisAt: null,
    lastFullCycleAt: null,
    lockHeld: false,
  }),
}));

vi.mock('../../../../lib/flywheel/retro-writer.js', () => ({
  parseRetroMarkdown: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { computeFlywheelMetrics, readNonArchivedRetroFiles, issueIdFromFilename, buildRollbackPreviewDiff, resolveRollbackRepoDir, fetchRetrosForIssueId } from '../flywheel.js';
import { parseRetroMarkdown } from '../../../../lib/flywheel/retro-writer.js';
import { resolveProjectFromIssue } from '../../../../lib/projects.js';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockParseRetroMarkdown = vi.mocked(parseRetroMarkdown);
const mockResolveProjectFromIssue = vi.mocked(resolveProjectFromIssue);

beforeEach(() => {
  vi.clearAllMocks();
  mockReaddir.mockResolvedValue([]);
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockParseRetroMarkdown.mockReturnValue(null);
  mockResolveProjectFromIssue.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// issueIdFromFilename
// ---------------------------------------------------------------------------

describe('issueIdFromFilename', () => {
  it('strips timestamp suffix and uppercases', () => {
    expect(issueIdFromFilename('PAN-001-1234567890.md')).toBe('PAN-001');
  });

  it('strips the timestamp and uppercases a multi-segment filename', () => {
    expect(issueIdFromFilename('pan-999-1714000000000.md')).toBe('PAN-999');
  });
});

// ---------------------------------------------------------------------------
// computeFlywheelMetrics
// ---------------------------------------------------------------------------

describe('computeFlywheelMetrics', () => {
  it('returns zeros for empty file list', () => {
    const result = computeFlywheelMetrics([]);
    expect(result).toEqual({ retrosProcessed: 0, retrosNoOp: 0, topPatterns: [] });
  });

  it('does not include skillsAdded or skillsRefined', () => {
    const result = computeFlywheelMetrics([]);
    expect(result).not.toHaveProperty('skillsAdded');
    expect(result).not.toHaveProperty('skillsRefined');
  });

  it('counts non-surprise retros as noOp', () => {
    mockParseRetroMarkdown.mockReturnValue({
      frontmatter: { surprise: false, friction_score: 0, proposed_changes: [] },
      body: '',
    } as ReturnType<typeof parseRetroMarkdown>);

    const result = computeFlywheelMetrics([{ content: 'a' }, { content: 'b' }]);
    expect(result.retrosProcessed).toBe(2);
    expect(result.retrosNoOp).toBe(2);
    expect(result.topPatterns).toHaveLength(0);
  });

  it('aggregates pattern counts from surprise retros', () => {
    mockParseRetroMarkdown.mockReturnValue({
      frontmatter: {
        surprise: true,
        friction_score: 8,
        proposed_changes: [{ type: 'update_skill', name: 'pan-review', section: 'guidance', change: 'fix X' }],
      },
      body: 'surprise!',
    } as ReturnType<typeof parseRetroMarkdown>);

    const result = computeFlywheelMetrics([{ content: 'x' }, { content: 'y' }, { content: 'z' }]);
    expect(result.retrosProcessed).toBe(3);
    expect(result.retrosNoOp).toBe(0);
    expect(result.topPatterns).toHaveLength(1);
    expect(result.topPatterns[0]).toEqual({ pattern: 'pan-review', issueCount: 3 });
  });

  it('limits topPatterns to 5 entries', () => {
    let callCount = 0;
    const patterns = ['a', 'b', 'c', 'd', 'e', 'f'];
    mockParseRetroMarkdown.mockImplementation(() => ({
      frontmatter: {
        surprise: true,
        friction_score: 5,
        proposed_changes: [{ type: 'update_skill', name: patterns[callCount++ % patterns.length], section: '', change: '' }],
      },
      body: '',
    } as ReturnType<typeof parseRetroMarkdown>));

    const result = computeFlywheelMetrics(patterns.map((_, i) => ({ content: `content-${i}` })));
    expect(result.topPatterns.length).toBeLessThanOrEqual(5);
  });

  it('skips no_op change types when aggregating patterns', () => {
    mockParseRetroMarkdown.mockReturnValue({
      frontmatter: {
        surprise: true,
        friction_score: 1,
        proposed_changes: [{ type: 'no_op', reason: 'no change needed' }],
      },
      body: '',
    } as ReturnType<typeof parseRetroMarkdown>);

    const result = computeFlywheelMetrics([{ content: 'x' }]);
    expect(result.topPatterns).toHaveLength(0);
    expect(result.retrosNoOp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readNonArchivedRetroFiles
// ---------------------------------------------------------------------------

describe('readNonArchivedRetroFiles', () => {
  it('returns [] when retros directory does not exist', async () => {
    mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const result = await readNonArchivedRetroFiles();
    expect(result).toEqual([]);
  });

  it('returns [] when directory is empty', async () => {
    mockReaddir.mockResolvedValue([]);
    const result = await readNonArchivedRetroFiles();
    expect(result).toEqual([]);
  });

  it('skips the archive subdirectory', async () => {
    mockReaddir.mockResolvedValue(['archive', 'PAN-001-123.md'] as unknown as ReturnType<typeof fsPromises.readdir> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue('content' as unknown as Buffer);
    const result = await readNonArchivedRetroFiles();
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('PAN-001-123.md');
  });

  it('skips non-.md files', async () => {
    mockReaddir.mockResolvedValue(['PAN-001-123.md', 'README.txt'] as unknown as ReturnType<typeof fsPromises.readdir> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue('md content' as unknown as Buffer);
    const result = await readNonArchivedRetroFiles();
    expect(result).toHaveLength(1);
  });

  it('returns filename and content for each .md file', async () => {
    mockReaddir.mockResolvedValue(['PAN-042-999.md'] as unknown as ReturnType<typeof fsPromises.readdir> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue('retro body' as unknown as Buffer);
    const result = await readNonArchivedRetroFiles();
    expect(result[0].filename).toBe('PAN-042-999.md');
    expect(result[0].content).toBe('retro body');
  });
});

// ---------------------------------------------------------------------------
// buildRollbackPreviewDiff
// ---------------------------------------------------------------------------

describe('buildRollbackPreviewDiff', () => {
  it('returns the raw diff unchanged — must not invert +/- content lines', () => {
    // Regression: old code manually inverted +/- lines but left file headers (---/+++)
    // intact, producing a malformed patch.  The correct fix is to call
    // `git diff commitSha commitSha^` (reversed order) so git itself produces
    // the revert diff.  This helper must be a pure pass-through.
    const raw = [
      'diff --git a/SKILL.md b/SKILL.md',
      '--- a/SKILL.md',
      '+++ b/SKILL.md',
      '@@ -1,3 +1,3 @@',
      ' context line',
      '-removed line',
      '+added line',
    ].join('\n');
    expect(buildRollbackPreviewDiff(raw)).toBe(raw);
  });

  it('handles empty diff (no commit found or no changes)', () => {
    expect(buildRollbackPreviewDiff('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveRollbackRepoDir — repo selection regression (PAN-709 review-025 fix 3)
// Old code hardcoded ~/docs as the git repo for rollback preview. Flywheel-change
// issues are implemented in the panopticon-cli project repo, not ~/docs.
// Fixed: resolveProjectFromIssue determines the correct repo directory.
// ---------------------------------------------------------------------------

describe('resolveRollbackRepoDir', () => {
  it('returns project.projectPath when the issue resolves to a known project', () => {
    mockResolveProjectFromIssue.mockReturnValue({ projectPath: '/home/user/my-project' } as ReturnType<typeof resolveProjectFromIssue>);
    expect(resolveRollbackRepoDir('PAN-001')).toBe('/home/user/my-project');
  });

  it('falls back to process.cwd() when the issue cannot be resolved', () => {
    mockResolveProjectFromIssue.mockReturnValue(null);
    expect(resolveRollbackRepoDir('PAN-UNKNOWN')).toBe(process.cwd());
  });
});

// ---------------------------------------------------------------------------
// fetchRetrosForIssueId — provenance index fallback (PAN-709 review-026 fix 1)
// Flywheel-change issues have no retro files named after them. The retros endpoint
// must fall back to the provenance index (written by the daemon at issue-filing time)
// to find which source-issue retros triggered the flywheel-change.
// ---------------------------------------------------------------------------

describe('fetchRetrosForIssueId', () => {
  it('returns retros matched by filename for source issues (direct match)', async () => {
    mockReaddir.mockResolvedValue(['PAN-600-1714000000.md'] as unknown as ReturnType<typeof readdir> extends Promise<infer T> ? T : never);
    mockReadFile.mockResolvedValue('retro body' as unknown as Buffer);
    mockParseRetroMarkdown.mockReturnValue({
      frontmatter: { surprise: true, friction_score: 8, proposed_changes: [{ type: 'update_skill', name: 'pan-review', section: '', change: '' }] },
      body: 'First summary line\nSecond line',
    } as ReturnType<typeof parseRetroMarkdown>);

    const result = await fetchRetrosForIssueId('PAN-600');

    expect(result.retros).toHaveLength(1);
    expect(result.retros[0].filename).toBe('PAN-600-1714000000.md');
    expect(result.signalCount).toBe(1);
  });

  it('returns triggering retros via provenance index when no direct filename match exists', async () => {
    // Flywheel-change issue 'PAN-750' has no retros named PAN-750-*.md.
    // Provenance index maps issue number '750' → ['PAN-600-1714000000.md'].
    mockReaddir.mockResolvedValue(['PAN-600-1714000000.md'] as unknown as ReturnType<typeof readdir> extends Promise<infer T> ? T : never);
    mockReadFile.mockImplementation(async (path: unknown) => {
      if (String(path).includes('provenance-index.json')) {
        return JSON.stringify({ '750': ['PAN-600-1714000000.md'] }) as unknown as Buffer;
      }
      return 'retro body' as unknown as Buffer;
    });
    mockParseRetroMarkdown.mockReturnValue({
      frontmatter: { surprise: true, friction_score: 7, proposed_changes: [{ type: 'update_skill', name: 'pan-review', section: '', change: '' }] },
      body: 'Triggering retro summary',
    } as ReturnType<typeof parseRetroMarkdown>);

    const result = await fetchRetrosForIssueId('PAN-750');

    expect(result.retros).toHaveLength(1);
    expect(result.retros[0].filename).toBe('PAN-600-1714000000.md');
    expect(result.signalCount).toBe(1);
    expect(result.skillName).toBe('pan-review');
  });

  it('returns empty result when neither direct match nor provenance entry exists', async () => {
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await fetchRetrosForIssueId('PAN-UNKNOWN');

    expect(result.retros).toEqual([]);
    expect(result.signalCount).toBe(0);
  });
});
