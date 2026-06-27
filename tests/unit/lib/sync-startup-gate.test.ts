import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs = vi.hoisted(() => ({
  base: '',
  overdeck: '',
  claude: '',
  syncSources: '',
  projects: [] as Array<{ config: { path: string; name: string } }>,
}));

vi.mock('../../../src/lib/paths.js', () => ({
  OVERDECK_HOME: dirs.overdeck,
  SKILLS_DIR: join(dirs.overdeck, 'skills'),
  COMMANDS_DIR: join(dirs.overdeck, 'commands'),
  AGENTS_DIR: join(dirs.overdeck, 'agents'),
  BIN_DIR: join(dirs.overdeck, 'bin'),
  CLAUDE_DIR: dirs.claude,
  SYNC_SOURCES: {
    root: dirs.syncSources,
    skills: join(dirs.syncSources, 'skills'),
    devSkills: join(dirs.syncSources, 'dev-skills'),
    agents: join(dirs.syncSources, 'agents'),
    rules: join(dirs.syncSources, 'rules'),
    hooks: join(dirs.syncSources, 'hooks'),
    gitHooks: join(dirs.syncSources, 'hooks', 'git-hooks'),
    templates: join(dirs.syncSources, 'templates'),
    traefikTemplates: join(dirs.syncSources, 'templates', 'traefik'),
    claudeMdSections: join(dirs.syncSources, 'templates', 'claude-md', 'sections'),
  },
  CACHE_AGENTS_DIR: join(dirs.overdeck, 'agent-definitions'),
  CACHE_RULES_DIR: join(dirs.overdeck, 'rules'),
  CACHE_MANIFEST: join(dirs.overdeck, '.manifest.json'),
  SYNC_TARGET: {
    skills: join(dirs.claude, 'skills'),
    commands: join(dirs.claude, 'commands'),
    agents: join(dirs.claude, 'agents'),
  },
  isDevMode: () => false,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  listProjectsSync: () => dirs.projects,
}));

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('isStartupSyncNeededSync', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-sync-gate-'));
    dirs.overdeck = join(dirs.base, 'overdeck');
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.syncSources = join(dirs.base, 'sync-sources');
  });

  beforeEach(() => {
    dirs.projects = [];
    // Seed the minimal sync input tree so the gate can hash it.
    for (const subdir of ['skills', 'dev-skills', 'agents', 'rules', 'hooks', 'templates']) {
      mkdirSync(join(dirs.syncSources, subdir), { recursive: true });
      write(join(dirs.syncSources, subdir, '.gitkeep'), '');
    }
    mkdirSync(join(dirs.syncSources, 'hooks', 'git-hooks'), { recursive: true });
    write(join(dirs.syncSources, 'hooks', 'git-hooks', '.gitkeep'), '');
    mkdirSync(join(dirs.syncSources, 'templates', 'traefik'), { recursive: true });
    write(join(dirs.syncSources, 'templates', 'traefik', '.gitkeep'), '');
    mkdirSync(join(dirs.syncSources, 'templates', 'claude-md', 'sections'), { recursive: true });
    write(join(dirs.syncSources, 'templates', 'claude-md', 'sections', '.gitkeep'), '');
    mkdirSync(join(dirs.overdeck, 'context'), { recursive: true });
    write(join(dirs.overdeck, 'context', 'global.md'), '# global\n');
  });

  afterAll(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  it('returns needed when no manifest exists', async () => {
    const { isStartupSyncNeededSync } = await import('../../../src/lib/sync.js');
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(true);
    expect(result.reason).toMatch(/inputs changed or no manifest/);
  });

  it('returns not needed after writing the manifest with unchanged inputs', async () => {
    const { isStartupSyncNeededSync, writeSyncManifestSync } = await import('../../../src/lib/sync.js');
    writeSyncManifestSync();
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(false);
    expect(result.reason).toBe('inputs unchanged');
  });

  it('returns needed when a sync source file changes', async () => {
    const { isStartupSyncNeededSync, writeSyncManifestSync } = await import('../../../src/lib/sync.js');
    writeSyncManifestSync();
    write(join(dirs.syncSources, 'skills', 'foo.md'), 'changed');
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(true);
  });

  it('returns needed when global.md changes', async () => {
    const { isStartupSyncNeededSync, writeSyncManifestSync } = await import('../../../src/lib/sync.js');
    writeSyncManifestSync();
    write(join(dirs.overdeck, 'context', 'global.md'), '# global changed\n');
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(true);
  });

  it('returns needed when a project context file changes', async () => {
    const projectPath = join(dirs.base, 'project-a');
    mkdirSync(join(projectPath, '.pan', 'context'), { recursive: true });
    write(join(projectPath, '.pan', 'context', 'project.md'), '# project\n');
    dirs.projects = [{ config: { path: projectPath, name: 'project-a' } }];

    const { isStartupSyncNeededSync, writeSyncManifestSync } = await import('../../../src/lib/sync.js');
    writeSyncManifestSync();
    write(join(projectPath, '.pan', 'context', 'project.md'), '# project changed\n');
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(true);
  });

  it('falls back to needed when a sync source directory is missing', async () => {
    rmSync(join(dirs.syncSources, 'rules'), { recursive: true, force: true });
    const { isStartupSyncNeededSync } = await import('../../../src/lib/sync.js');
    const result = isStartupSyncNeededSync();
    expect(result.needed).toBe(true);
    expect(result.reason).toMatch(/hash computation failed/);
  });
});
