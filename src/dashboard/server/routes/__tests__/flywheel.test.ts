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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { computeFlywheelMetrics, readNonArchivedRetroFiles, issueIdFromFilename } from '../flywheel.js';
import { parseRetroMarkdown } from '../../../../lib/flywheel/retro-writer.js';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockParseRetroMarkdown = vi.mocked(parseRetroMarkdown);

beforeEach(() => {
  vi.clearAllMocks();
  mockReaddir.mockResolvedValue([]);
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockParseRetroMarkdown.mockReturnValue(null);
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
        proposed_changes: [{ type: 'skill_change', name: 'pan-review', description: 'fix X' }],
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
        proposed_changes: [{ type: 'skill_change', name: patterns[callCount++ % patterns.length], description: '' }],
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
        proposed_changes: [{ type: 'no_op', name: 'pan-review', description: '' }],
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
