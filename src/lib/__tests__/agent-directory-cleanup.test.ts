/**
 * Tests for agent directory cleanup (PAN-801)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isValidAgentDirectoryName,
  isLegacyConversationDirectory,
  getPlanningIssueId,
  findOrphanedAgentDirs,
  cleanupAgentDirectories,
} from '../agent-directory-cleanup.js';

let TEST_DIR: string;

// Mock tmux module
vi.mock('../tmux.js', () => ({
  listSessionNamesAsync: vi.fn(),
}));

import { listSessionNamesAsync } from '../tmux.js';

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `agent-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
  vi.mocked(listSessionNamesAsync).mockReset();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------
// isValidAgentDirectoryName
// ------------------------------------------------------------------

describe('isValidAgentDirectoryName', () => {
  it('accepts standard lowercase agent directories', () => {
    expect(isValidAgentDirectoryName('agent-pan-801')).toBe(true);
    expect(isValidAgentDirectoryName('agent-min-215')).toBe(true);
    expect(isValidAgentDirectoryName('agent-aur-42')).toBe(true);
  });

  it('accepts rally-format directories', () => {
    expect(isValidAgentDirectoryName('agent-f29698')).toBe(true);
    expect(isValidAgentDirectoryName('agent-us12345')).toBe(true);
  });

  it('rejects planning directories (handled separately)', () => {
    expect(isValidAgentDirectoryName('planning-pan-801')).toBe(false);
    expect(isValidAgentDirectoryName('planning-min-5')).toBe(false);
  });

  it('rejects bare numeric agent directories', () => {
    expect(isValidAgentDirectoryName('agent-108')).toBe(false);
    expect(isValidAgentDirectoryName('agent-0')).toBe(false);
  });

  it('rejects uppercase issue IDs', () => {
    expect(isValidAgentDirectoryName('agent-MIN-791')).toBe(false);
    expect(isValidAgentDirectoryName('agent-PAN-123')).toBe(false);
  });

  it('rejects doubled prefixes', () => {
    expect(isValidAgentDirectoryName('agent-agent-pan-699')).toBe(false);
    expect(isValidAgentDirectoryName('agent-planning-pan-805')).toBe(false);
  });

  it('rejects old role-prefixed directories', () => {
    expect(isValidAgentDirectoryName('work-pan-208')).toBe(false);
    expect(isValidAgentDirectoryName('review-pan-646')).toBe(false);
    expect(isValidAgentDirectoryName('test-pan-646')).toBe(false);
    expect(isValidAgentDirectoryName('merge-pan-646')).toBe(false);
  });

  it('accepts specialist role directories (review/test/ship convoy)', () => {
    expect(isValidAgentDirectoryName('agent-pan-457-review')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-review-correctness')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-review-security')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-review-performance')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-review-requirements')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-test')).toBe(true);
    expect(isValidAgentDirectoryName('agent-pan-457-ship')).toBe(true);
    expect(isValidAgentDirectoryName('agent-min-215-work-1')).toBe(true);
  });

  it('rejects multi-word test directories', () => {
    expect(isValidAgentDirectoryName('agent-pan-test-1')).toBe(false);
    expect(isValidAgentDirectoryName('agent-pan-sagox-1')).toBe(false);
    expect(isValidAgentDirectoryName('agent-fresh-ok-1777091978786-zqzy99')).toBe(false);
  });

  it('rejects conv-* and specialist-* directories', () => {
    expect(isValidAgentDirectoryName('conv-20260411-1125')).toBe(false);
    expect(isValidAgentDirectoryName('specialist-panopticon-cli-test-agent')).toBe(false);
  });

  it('rejects unknown names', () => {
    expect(isValidAgentDirectoryName('random-dir')).toBe(false);
    expect(isValidAgentDirectoryName('agent')).toBe(false);
    expect(isValidAgentDirectoryName('planning')).toBe(false);
  });
});

// ------------------------------------------------------------------
// isLegacyConversationDirectory
// ------------------------------------------------------------------

describe('isLegacyConversationDirectory', () => {
  it('identifies conv-* directories as legacy', () => {
    expect(isLegacyConversationDirectory('conv-20260411-1125')).toBe(true);
    expect(isLegacyConversationDirectory('conv-20260425-025517-630')).toBe(true);
  });

  it('rejects non-conv directories', () => {
    expect(isLegacyConversationDirectory('agent-pan-801')).toBe(false);
    expect(isLegacyConversationDirectory('planning-pan-801')).toBe(false);
    expect(isLegacyConversationDirectory('random-dir')).toBe(false);
  });
});

// ------------------------------------------------------------------
// getPlanningIssueId
// ------------------------------------------------------------------

describe('getPlanningIssueId', () => {
  it('extracts issue ID from valid planning directories', () => {
    expect(getPlanningIssueId('planning-pan-801')).toBe('pan-801');
    expect(getPlanningIssueId('planning-min-5')).toBe('min-5');
  });

  it('returns null for invalid planning directories', () => {
    expect(getPlanningIssueId('planning-PAN-123')).toBeNull(); // uppercase
    expect(getPlanningIssueId('planning-108')).toBeNull(); // bare numeric
  });

  it('returns null for non-planning directories', () => {
    expect(getPlanningIssueId('agent-pan-801')).toBeNull();
    expect(getPlanningIssueId('conv-20260411-1125')).toBeNull();
  });
});

// ------------------------------------------------------------------
// findOrphanedAgentDirs
// ------------------------------------------------------------------

describe('findOrphanedAgentDirs', () => {
  it('returns empty array when agents dir does not exist', async () => {
    const result = await findOrphanedAgentDirs(join(TEST_DIR, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('returns empty array when all directories are valid agents with no stale planning', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue(['planning-pan-801']);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-801'), { recursive: true });

    const result = await findOrphanedAgentDirs(TEST_DIR);
    expect(result).toEqual([]);
  });

  it('identifies legacy directories as orphaned', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'agent-108'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'work-pan-208'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'conv-20260411-1125'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'specialist-test-agent'), { recursive: true });

    const result = await findOrphanedAgentDirs(TEST_DIR);
    const names = result.map((d) => d.name).sort();

    expect(names).toEqual(['agent-108', 'conv-20260411-1125', 'specialist-test-agent', 'work-pan-208']);
    expect(result.every((d) => !d.hasRunningSession)).toBe(true);
  });

  it('treats stale planning directories (no running session) as orphaned', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-569'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-min-787'), { recursive: true });

    const result = await findOrphanedAgentDirs(TEST_DIR);
    const names = result.map((d) => d.name).sort();

    expect(names).toEqual(['planning-min-787', 'planning-pan-569']);
  });

  it('preserves planning directories with running tmux sessions', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue(['planning-pan-817']);

    mkdirSync(join(TEST_DIR, 'planning-pan-817'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-569'), { recursive: true });

    const result = await findOrphanedAgentDirs(TEST_DIR);
    const names = result.map((d) => d.name).sort();

    expect(names).toEqual(['planning-pan-569']);
    expect(result[0].hasRunningSession).toBe(false);
  });

  it('marks running legacy sessions as protected', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue(['conv-20260411-1125']);

    mkdirSync(join(TEST_DIR, 'conv-20260411-1125'), { recursive: true });

    const result = await findOrphanedAgentDirs(TEST_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('conv-20260411-1125');
    expect(result[0].hasRunningSession).toBe(true);
  });
});

// ------------------------------------------------------------------
// cleanupAgentDirectories
// ------------------------------------------------------------------

describe('cleanupAgentDirectories', () => {
  it('dry-run previews orphaned directories without deleting', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'agent-108'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-569'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'conv-20260411-1125'), { recursive: true });

    const result = await cleanupAgentDirectories({
      dryRun: true,
      agentsDir: TEST_DIR,
    });

    expect(result.totalOrphaned).toBe(3);
    expect(result.wouldRemove).toContain('agent-108');
    expect(result.wouldRemove).toContain('planning-pan-569');
    expect(result.wouldRemove).toContain('conv-20260411-1125');
    expect(result.removed).toEqual([]);
    expect(result.protected).toEqual([]);

    // Verify nothing was deleted
    expect(existsSync(join(TEST_DIR, 'agent-108'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'planning-pan-569'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'conv-20260411-1125'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'agent-pan-801'))).toBe(true);
  });

  it('removes orphaned directories in non-dry-run mode', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'agent-108'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-569'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'conv-20260411-1125'), { recursive: true });

    const result = await cleanupAgentDirectories({
      dryRun: false,
      force: true,
      agentsDir: TEST_DIR,
    });

    expect(result.totalOrphaned).toBe(3);
    expect(result.removed).toContain('agent-108');
    expect(result.removed).toContain('planning-pan-569');
    expect(result.removed).toContain('conv-20260411-1125');
    expect(result.wouldRemove).toEqual([]);
    expect(result.protected).toEqual([]);

    // Verify deletion
    expect(existsSync(join(TEST_DIR, 'agent-108'))).toBe(false);
    expect(existsSync(join(TEST_DIR, 'planning-pan-569'))).toBe(false);
    expect(existsSync(join(TEST_DIR, 'conv-20260411-1125'))).toBe(false);
    expect(existsSync(join(TEST_DIR, 'agent-pan-801'))).toBe(true);
  });

  it('never touches valid agent directories', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    mkdirSync(join(TEST_DIR, 'agent-pan-801'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'agent-min-215'), { recursive: true });

    const result = await cleanupAgentDirectories({
      dryRun: false,
      force: true,
      agentsDir: TEST_DIR,
    });

    expect(result.totalOrphaned).toBe(0);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(TEST_DIR, 'agent-pan-801'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'agent-min-215'))).toBe(true);
  });

  it('protects running planning and conv sessions', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'planning-pan-817',
      'conv-20260425-025517-630',
    ]);

    mkdirSync(join(TEST_DIR, 'planning-pan-817'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'conv-20260425-025517-630'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'planning-pan-569'), { recursive: true });

    const result = await cleanupAgentDirectories({
      dryRun: false,
      force: true,
      agentsDir: TEST_DIR,
    });

    expect(result.totalOrphaned).toBe(2);
    expect(result.protected).toContain('conv-20260425-025517-630');
    expect(result.removed).toContain('planning-pan-569');

    expect(existsSync(join(TEST_DIR, 'planning-pan-817'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'conv-20260425-025517-630'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'planning-pan-569'))).toBe(false);
  });

  it('handles empty agents directory', async () => {
    vi.mocked(listSessionNamesAsync).mockResolvedValue([]);

    const result = await cleanupAgentDirectories({
      dryRun: false,
      force: true,
      agentsDir: TEST_DIR,
    });

    expect(result.totalOrphaned).toBe(0);
    expect(result.removed).toEqual([]);
    expect(result.protected).toEqual([]);
    expect(result.wouldRemove).toEqual([]);
  });
});
