/**
 * Command-level regression test: syncCommand invokes mirrorProjectSkills
 * against getDevrootPath() so project-skill mirroring works from any cwd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

const mockMirrorProjectSkills = vi.fn().mockReturnValue({ added: [], updated: [], removed: [] });
const mockGetDevrootPath = vi.fn().mockReturnValue(null);
const mockLoadConfig = vi.fn().mockReturnValue({ sync: {} });
const mockPlanSync = vi.fn().mockReturnValue({ toAdd: [], toUpdate: [], toRemove: [], errors: [] });
const mockExecuteSync = vi.fn().mockReturnValue({ created: [], updated: [], skipped: [], conflicts: [], diffs: [], errors: [] });
const mockRefreshCache = vi.fn().mockReturnValue({ skills: { copied: 0 }, agents: { copied: 0 }, rules: { copied: 0 } });
const mockMigrateStalePersonalContent = vi.fn().mockReturnValue({ removedSymlinks: [], preservedUserContent: [] });
const mockRemoveLegacySkills070 = vi.fn().mockReturnValue([]);
const mockPlanHooksSync = vi.fn().mockReturnValue({ toInstall: [], toUpdate: [], toRemove: [] });
const mockSyncHooks = vi.fn().mockReturnValue({ synced: [], errors: [] });
const mockSyncStatusline = vi.fn().mockReturnValue({ synced: [], errors: [] });
const mockListProjects = vi.fn().mockReturnValue([]);
const mockCleanupLegacyRuntimeSymlinks = vi.fn().mockReturnValue({ cleaned: [], total: 0 });
const mockMigrateSyncTargets = vi.fn().mockReturnValue({ migrated: [], skipped: [] });
const mockMigratePanopticonToPan = vi.fn().mockResolvedValue(undefined);
const mockRunMultiToolSync = vi.fn().mockResolvedValue({ results: [] });
const mockResolveAlsoSyncTools = vi.fn().mockReturnValue([]);
const mockEnsurePlaywrightIsolation = vi.fn().mockResolvedValue(undefined);
const mockCreateBackup = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/lib/sync.js', () => ({
  planSync: mockPlanSync,
  executeSync: mockExecuteSync,
  refreshCache: mockRefreshCache,
  migrateStalePersonalContent: mockMigrateStalePersonalContent,
  removeLegacySkills070: mockRemoveLegacySkills070,
  planHooksSync: mockPlanHooksSync,
  syncHooks: mockSyncHooks,
  syncStatusline: mockSyncStatusline,
  mirrorProjectSkills: mockMirrorProjectSkills,
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: mockLoadConfig,
  getDevrootPath: mockGetDevrootPath,
  getDashboardApiUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjects: mockListProjects,
}));

vi.mock('../../../src/lib/config-migration.js', () => ({
  cleanupLegacyRuntimeSymlinks: mockCleanupLegacyRuntimeSymlinks,
  migrateSyncTargets: mockMigrateSyncTargets,
}));

vi.mock('../../../src/lib/workspace-manager.js', () => ({
  migratePanopticonToPan: mockMigratePanopticonToPan,
}));

vi.mock('../../../src/lib/multi-tool-sync.js', () => ({
  runMultiToolSync: mockRunMultiToolSync,
  resolveAlsoSyncTools: mockResolveAlsoSyncTools,
}));

vi.mock('../../../src/lib/claude-mcp.js', () => ({
  ensurePlaywrightIsolation: mockEnsurePlaywrightIsolation,
}));

vi.mock('../../../src/lib/backup.js', () => ({
  createBackup: mockCreateBackup,
}));

vi.mock('../../../src/lib/paths.js', () => ({
  SYNC_TARGET: { skills: '/tmp/skills', commands: '/tmp/commands', agents: '/tmp/agents' },
  SKILLS_DIR: '/tmp/pan-skills',
  isDevMode: vi.fn().mockReturnValue(false),
  AGENTS_DIR: '/tmp/agents',
}));

vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ text: '', succeed: vi.fn(), fail: vi.fn(), warn: vi.fn(), stop: vi.fn(), info: vi.fn() }),
  }),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('syncCommand — mirrorProjectSkills integration', () => {
  beforeEach(() => {
    vi.resetModules();
    mockMirrorProjectSkills.mockReturnValue({ added: [], updated: [], removed: [] });
    mockGetDevrootPath.mockReturnValue(null);
    mockLoadConfig.mockReturnValue({ sync: {} });
    mockListProjects.mockReturnValue([]);
    mockPlanSync.mockReturnValue({ toAdd: [], toUpdate: [], toRemove: [], errors: [] });
  });

  it('calls mirrorProjectSkills with devroot when getDevrootPath returns a path', async () => {
    mockGetDevrootPath.mockReturnValue('/home/user/projects/panopticon-cli');

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    expect(mockMirrorProjectSkills).toHaveBeenCalledWith('/home/user/projects/panopticon-cli');
  });

  it('calls mirrorProjectSkills with process.cwd() when no devroot is configured', async () => {
    mockGetDevrootPath.mockReturnValue(null);

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    expect(mockMirrorProjectSkills).toHaveBeenCalledWith(process.cwd());
  });

  it('logs skill mirror results when files are added or updated', async () => {
    mockGetDevrootPath.mockReturnValue('/home/user/projects/panopticon-cli');
    mockMirrorProjectSkills.mockReturnValue({
      added: ['new-skill'],
      updated: ['existing-skill'],
      removed: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    const mirrorLog = consoleSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('Skills mirror')
    );
    expect(mirrorLog).toBeDefined();
    expect(mirrorLog![0]).toContain('1 added');
    expect(mirrorLog![0]).toContain('1 updated');

    consoleSpy.mockRestore();
  });

  it('does not log when mirrorProjectSkills returns no changes', async () => {
    mockGetDevrootPath.mockReturnValue(null);
    mockMirrorProjectSkills.mockReturnValue({ added: [], updated: [], removed: [] });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    const mirrorLog = consoleSpy.mock.calls.find(([msg]) =>
      typeof msg === 'string' && msg.includes('Skills mirror')
    );
    expect(mirrorLog).toBeUndefined();

    consoleSpy.mockRestore();
  });
});
