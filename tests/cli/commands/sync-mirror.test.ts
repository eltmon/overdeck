/**
 * Command-level regression test for `pan sync` (PAN-1201 layered model).
 *
 * `pan sync` no longer distributes through `<devroot>/.claude/`. It mirrors a
 * project's own skills/ tree from the current working directory, and renders
 * the layered context into harness CLAUDE.md files via syncContextLayers().
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

const mockMirrorProjectSkills = vi.fn().mockReturnValue({ added: [], updated: [], removed: [] });
const mockCheckDevrootDeprecation = vi.fn().mockReturnValue(null);
const mockLoadConfig = vi.fn().mockReturnValue({ sync: {} });
const mockPlanSync = vi.fn().mockReturnValue({ skills: [], commands: [], agents: [], rules: [], devSkills: [] });
const mockExecuteSync = vi.fn().mockReturnValue({ created: [], updated: [], adopted: [], skipped: [], conflicts: [], diffs: [] });
const mockSyncContextLayers = vi.fn().mockReturnValue({ globalWritten: false, globalStubCreated: false, projectsWritten: [], errors: [], firstInjections: [] });
const mockRefreshCache = vi.fn().mockReturnValue({ skills: { copied: 0 }, agents: { copied: 0 }, rules: { copied: 0 } });
const mockMigrateStalePersonalContent = vi.fn().mockReturnValue({ removedSymlinks: [], preservedUserContent: [] });
const mockRemoveLegacySkills070 = vi.fn().mockReturnValue([]);
const mockPlanHooksSync = vi.fn().mockReturnValue([]);
const mockSyncHooks = vi.fn().mockReturnValue({ synced: [], errors: [] });
const mockSyncStatusline = vi.fn().mockReturnValue({ synced: [], errors: [] });
const mockListProjects = vi.fn().mockReturnValue([]);
const mockCleanupLegacyRuntimeSymlinks = vi.fn().mockReturnValue({ cleaned: [], total: 0 });
const mockMigrateSyncTargets = vi.fn().mockReturnValue({ migrated: [], skipped: [] });
const mockMigrateOverdeckToPan = vi.fn().mockReturnValue({ migrated: [], skipped: [], errors: [] });
const mockRunMultiToolSync = vi.fn().mockReturnValue([]);
const mockResolveAlsoSyncTools = vi.fn().mockReturnValue([]);
const mockEnsurePlaywrightIsolation = vi.fn().mockReturnValue(false);
const mockEnsureExcalidrawMcp = vi.fn().mockReturnValue(false);
const mockCreateBackup = vi.fn().mockReturnValue({ targets: [], timestamp: 'now' });
const mockCleanupAgentDirectories = vi.fn().mockReturnValue(Effect.succeed({ totalOrphaned: 0, removed: [], protected: [], wouldRemove: [] }));
const mockStartupSyncNeeded = vi.fn().mockReturnValue({ needed: true, reason: 'test' });

vi.mock('../../../src/lib/sync.js', () => ({
  planSync: mockPlanSync,
  planSyncSync: mockPlanSync,
  executeSync: mockExecuteSync,
  executeSyncSync: mockExecuteSync,
  syncContextLayers: mockSyncContextLayers,
  syncContextLayersSync: mockSyncContextLayers,
  refreshCache: mockRefreshCache,
  refreshCacheSync: mockRefreshCache,
  migrateStalePersonalContent: mockMigrateStalePersonalContent,
  migrateStalePersonalContentSync: mockMigrateStalePersonalContent,
  removeLegacySkills070: mockRemoveLegacySkills070,
  removeLegacySkills070Sync: mockRemoveLegacySkills070,
  planHooksSync: mockPlanHooksSync,
  planHooksSyncSync: mockPlanHooksSync,
  syncHooks: mockSyncHooks,
  syncHooksSync: mockSyncHooks,
  syncStatusline: mockSyncStatusline,
  syncStatuslineSync: mockSyncStatusline,
  mirrorProjectSkills: mockMirrorProjectSkills,
  mirrorProjectSkillsSync: mockMirrorProjectSkills,
  syncPiSettings: vi.fn(() => ({ status: 'skipped', path: '/tmp/none', reason: 'pi not on PATH' })),
  syncPiSettingsSync: vi.fn(() => ({ status: 'skipped', path: '/tmp/none', reason: 'pi not on PATH' })),
  isStartupSyncNeededSync: mockStartupSyncNeeded,
  writeSyncManifestSync: vi.fn(),
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: mockLoadConfig,
  loadConfigSync: mockLoadConfig,
  checkDevrootDeprecation: mockCheckDevrootDeprecation,
  getDashboardApiUrl: vi.fn().mockReturnValue('http://localhost:3000'),
  getDashboardApiUrlSync: vi.fn().mockReturnValue('http://localhost:3000'),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjects: mockListProjects,
  listProjectsSync: mockListProjects,
}));

vi.mock('../../../src/lib/config-migration.js', () => ({
  cleanupLegacyRuntimeSymlinks: mockCleanupLegacyRuntimeSymlinks,
  cleanupLegacyRuntimeSymlinksSync: mockCleanupLegacyRuntimeSymlinks,
  migrateSyncTargets: mockMigrateSyncTargets,
  migrateSyncTargetsSync: mockMigrateSyncTargets,
}));

vi.mock('../../../src/lib/workspace-manager.js', () => ({
  migrateOverdeckToPan: mockMigrateOverdeckToPan,
  migrateOverdeckToPanSync: mockMigrateOverdeckToPan,
}));

vi.mock('../../../src/lib/multi-tool-sync.js', () => ({
  runMultiToolSync: mockRunMultiToolSync,
  runMultiToolSyncSync: mockRunMultiToolSync,
  resolveAlsoSyncTools: mockResolveAlsoSyncTools,
  resolveAlsoSyncToolsSync: mockResolveAlsoSyncTools,
}));

vi.mock('../../../src/lib/claude-mcp.js', () => ({
  ensurePlaywrightIsolation: mockEnsurePlaywrightIsolation,
  ensurePlaywrightIsolationSync: mockEnsurePlaywrightIsolation,
  ensureExcalidrawMcp: mockEnsureExcalidrawMcp,
  ensureExcalidrawMcpSync: mockEnsureExcalidrawMcp,
}));

vi.mock('../../../src/lib/backup.js', () => ({
  createBackup: mockCreateBackup,
  createBackupSync: mockCreateBackup,
}));

vi.mock('../../../src/lib/agent-directory-cleanup.js', () => ({
  cleanupAgentDirectories: mockCleanupAgentDirectories,
}));

vi.mock('../../../src/lib/paths.js', () => ({
  SYNC_TARGET: { skills: '/tmp/skills', commands: '/tmp/commands', agents: '/tmp/agents' },
  SYNC_SOURCES: { gitHooks: '/tmp/git-hooks', hooks: '/tmp/hooks', skills: '/tmp/src-skills' },
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

describe('syncCommand — layered sync (PAN-1201)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockMirrorProjectSkills.mockReturnValue({ added: [], updated: [], removed: [] });
    mockCheckDevrootDeprecation.mockReturnValue(null);
    mockLoadConfig.mockReturnValue({ sync: {} });
    mockListProjects.mockReturnValue([]);
    mockPlanSync.mockReturnValue({ skills: [], commands: [], agents: [], rules: [], devSkills: [] });
    mockSyncContextLayers.mockReturnValue({ globalWritten: false, globalStubCreated: false, projectsWritten: [], errors: [], firstInjections: [] });
    mockCleanupAgentDirectories.mockReturnValue(Effect.succeed({ totalOrphaned: 0, removed: [], protected: [], wouldRemove: [] }));
    mockStartupSyncNeeded.mockReturnValue({ needed: true, reason: 'test' });
  });

  it('mirrors project skills from the current working directory', async () => {
    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});
    expect(mockMirrorProjectSkills).toHaveBeenCalledWith(process.cwd());
  });

  it('renders the layered context into harness CLAUDE.md files', async () => {
    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});
    expect(mockSyncContextLayers).toHaveBeenCalledTimes(1);
  });

  it('prints the devroot deprecation warning when sync.devroot is still set', async () => {
    mockCheckDevrootDeprecation.mockReturnValue('[WARN] sync.devroot is deprecated');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    const warned = consoleSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('sync.devroot is deprecated'),
    );
    expect(warned).toBe(true);
    consoleSpy.mockRestore();
  });

  it('logs skill mirror results when files are added or updated', async () => {
    mockMirrorProjectSkills.mockReturnValue({ added: ['new-skill'], updated: ['existing-skill'], removed: [] });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    const mirrorLog = consoleSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Skills mirror'),
    );
    expect(mirrorLog).toBeDefined();
    expect(mirrorLog![0]).toContain('1 added');
    expect(mirrorLog![0]).toContain('1 updated');
    consoleSpy.mockRestore();
  });

  it('does not log a skill mirror line when there are no changes', async () => {
    mockMirrorProjectSkills.mockReturnValue({ added: [], updated: [], removed: [] });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    const mirrorLog = consoleSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Skills mirror'),
    );
    expect(mirrorLog).toBeUndefined();
    consoleSpy.mockRestore();
  });

  it('skips execution under --if-changed when startup sync inputs are unchanged', async () => {
    mockStartupSyncNeeded.mockReturnValue({ needed: false, reason: 'inputs unchanged' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({ ifChanged: true });

    expect(mockStartupSyncNeeded).toHaveBeenCalledTimes(1);
    expect(mockRefreshCache).not.toHaveBeenCalled();
    expect(mockMirrorProjectSkills).not.toHaveBeenCalled();
    expect(consoleSpy.mock.calls.some(
      ([msg]) => typeof msg === 'string' && msg.includes('[sync] skipped'),
    )).toBe(true);
    consoleSpy.mockRestore();
  });

  it('still executes a full sync by default when inputs are unchanged', async () => {
    mockStartupSyncNeeded.mockReturnValue({ needed: false, reason: 'inputs unchanged' });

    const { syncCommand } = await import('../../../src/cli/commands/sync.js');
    await syncCommand({});

    expect(mockStartupSyncNeeded).not.toHaveBeenCalled();
    expect(mockRefreshCache).toHaveBeenCalledTimes(1);
    expect(mockMirrorProjectSkills).toHaveBeenCalledWith(process.cwd());
  });
});
