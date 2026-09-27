import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs = vi.hoisted(() => ({
  base: '',
  overdeck: '',
  claude: '',
  syncSources: '',
  projects: [] as Array<{ key: string; config: { path: string; name: string } }>,
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

describe('isStartupSyncNeeded', () => {
  beforeAll(() => {
    dirs.base = mkdtempSync(join(tmpdir(), 'pan-sync-gate-'));
    dirs.overdeck = join(dirs.base, 'overdeck');
    dirs.claude = join(dirs.base, 'home', '.claude');
    dirs.syncSources = join(dirs.base, 'sync-sources');
  });

  beforeEach(() => {
    dirs.projects = [];
    rmSync(dirs.syncSources, { recursive: true, force: true });
    rmSync(join(dirs.overdeck, '.sync-manifest.json'), { force: true });
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
    const { isStartupSyncNeeded } = await import('../../../src/lib/sync.js');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
    expect(result.reason).toMatch(/inputs changed or no manifest/);
  });

  it('returns not needed after writing the manifest with unchanged inputs', async () => {
    const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(false);
    expect(result.reason).toBe('inputs unchanged');
  });

  it('returns needed when a sync source file changes', async () => {
    const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    write(join(dirs.syncSources, 'skills', 'foo.md'), 'changed');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
  });

  it('returns needed when global.md changes', async () => {
    const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    write(join(dirs.overdeck, 'context', 'global.md'), '# global changed\n');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
  });

  it('returns needed when a project context file changes', async () => {
    const projectPath = join(dirs.base, 'project-a');
    mkdirSync(join(projectPath, '.pan', 'context'), { recursive: true });
    write(join(projectPath, '.pan', 'context', 'project.md'), '# project\n');
    dirs.projects = [{ key: 'project-a', config: { path: projectPath, name: 'project-a' } }];

    const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    write(join(projectPath, '.pan', 'context', 'project.md'), '# project changed\n');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
  });

  it('returns needed when a project-local skill changes', async () => {
    const projectPath = join(dirs.base, 'project-skills');
    mkdirSync(join(projectPath, '.pan', 'skills', 'local-skill'), { recursive: true });
    write(join(projectPath, '.pan', 'skills', 'local-skill', 'SKILL.md'), '# local skill\n');
    dirs.projects = [{ key: 'project-skills', config: { path: projectPath, name: 'project-skills' } }];

    const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    write(join(projectPath, '.pan', 'skills', 'local-skill', 'SKILL.md'), '# local skill changed\n');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
  });

  it('returns needed when the cwd top-level skill mirror source changes', async () => {
    const projectPath = join(dirs.base, 'top-level-skills-project');
    const nestedPath = join(projectPath, 'nested');
    mkdirSync(join(projectPath, 'skills', 'local-skill'), { recursive: true });
    mkdirSync(nestedPath, { recursive: true });
    write(join(projectPath, 'skills', 'local-skill', 'SKILL.md'), '# top-level skill\n');

    const previousCwd = process.cwd();
    process.chdir(nestedPath);
    try {
      const { isStartupSyncNeeded, writeSyncManifest } = await import('../../../src/lib/sync.js');
      writeSyncManifest();
      write(join(projectPath, 'skills', 'local-skill', 'SKILL.md'), '# top-level skill changed\n');
      const result = isStartupSyncNeeded();
      expect(result.needed).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('falls back to needed when a sync source directory is missing', async () => {
    rmSync(join(dirs.syncSources, 'rules'), { recursive: true, force: true });
    const { isStartupSyncNeeded } = await import('../../../src/lib/sync.js');
    const result = isStartupSyncNeeded();
    expect(result.needed).toBe(true);
    expect(result.reason).toMatch(/hash computation failed/);
  });

  it('writes a v2 manifest with per-input digests', async () => {
    const { writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    const manifest = JSON.parse(readFileSync(join(dirs.overdeck, '.sync-manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(2);
    expect(typeof manifest.globalHash).toBe('string');
    expect(manifest.inputs).toHaveProperty('sync-sources/skills/.gitkeep');
  });

  it('reads not needed after writing the manifest', async () => {
    const { readSyncInputStatus, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    const manifest = JSON.parse(readFileSync(join(dirs.overdeck, '.sync-manifest.json'), 'utf-8'));
    const status = readSyncInputStatus();
    expect(status.needed).toBe(false);
    expect(status.attemptKey).toBe(manifest.globalHash);
  });

  it('says what changed since the last sync', async () => {
    const { readSyncInputStatus, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();
    write(join(dirs.syncSources, 'skills', 'foo', 'SKILL.md'), '# foo\n');
    write(join(dirs.syncSources, 'rules', 'a.md'), '# a\n');
    const status = readSyncInputStatus();
    expect(status.needed).toBe(true);
    expect(status.summary).toBe('1 skill and 1 rule changed');
    expect(status.changedKeys).toEqual(['sync-sources/rules/a.md', 'sync-sources/skills/foo/SKILL.md']);
  });

  it('ignores the cwd in the global comparison', async () => {
    const otherCwd = join(dirs.base, 'other-cwd');
    mkdirSync(otherCwd, { recursive: true });
    const { isStartupSyncNeeded, readSyncInputStatus, writeSyncManifest } = await import('../../../src/lib/sync.js');
    writeSyncManifest();

    const previousCwd = process.cwd();
    process.chdir(otherCwd);
    try {
      expect(readSyncInputStatus().needed).toBe(false);
      expect(isStartupSyncNeeded().needed).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('reads a v1 manifest as changed with no per-file record', async () => {
    write(join(dirs.overdeck, '.sync-manifest.json'), JSON.stringify({ hash: 'abc', generatedAt: '2026-01-01T00:00:00Z' }));
    const { readSyncInputStatus } = await import('../../../src/lib/sync.js');
    const status = readSyncInputStatus();
    expect(status.needed).toBe(true);
    expect(status.summary.startsWith('Setup inputs changed since the last sync')).toBe(true);
    expect(status.changedKeys).toEqual([]);
  });

  it('reports no recorded sync when the manifest is missing', async () => {
    const { readSyncInputStatus } = await import('../../../src/lib/sync.js');
    const status = readSyncInputStatus();
    expect(status.needed).toBe(true);
    expect(status.summary).toBe('No sync has been recorded on this machine');
  });

  it('keys the attempt on the error when a sync source is missing', async () => {
    rmSync(join(dirs.syncSources, 'rules'), { recursive: true, force: true });
    const { readSyncInputStatus } = await import('../../../src/lib/sync.js');
    const status = readSyncInputStatus();
    expect(status.needed).toBe(true);
    expect(status.attemptKey.startsWith('error:')).toBe(true);
    expect(status.summary).toMatch(/^Could not read sync inputs: missing sync input: rules/);
  });
});
