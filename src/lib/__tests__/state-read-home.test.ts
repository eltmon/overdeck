import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../projects.js';

// PROJECTS_CONFIG_FILE (src/lib/projects.ts:18) captures OVERDECK_HOME at module
// load, so listProjectsSync() cannot be steered by setting OVERDECK_HOME in
// beforeEach. Mock listProjectsSync to control the registered-project registry
// per test; keep resolveInfraRepo real so the legacy fallback path is exercised
// unchanged.
type RegisteredProject = { key: string; config: ProjectConfig };
const registry = vi.hoisted(() => ({ value: [] as RegisteredProject[] }));

vi.mock('../projects.js', async (importActual) => {
  const actual = await importActual<typeof import('../projects.js')>();
  return { ...actual, listProjectsSync: () => registry.value };
});

import { getOverdeckHome } from '../paths.js';
import { projectKey } from '../project-key.js';
import { resolveStateDomainPathSync, resolveStateReadHomeSync } from '../state-read-home.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function validMarkerJson(): string {
  return JSON.stringify({
    sourceMainSha: SHA_A,
    stateBranchSha: SHA_B,
    completedAt: '2026-07-09T20:00:00.000Z',
    version: 1,
  });
}

describe('resolveStateReadHomeSync (sync read door)', () => {
  let root: string;
  let overdeckHome: string;
  let projectPath: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-read-home-'));
    overdeckHome = join(root, 'overdeck-home');
    mkdirSync(overdeckHome, { recursive: true });
    // A project path whose basename deliberately differs from the registered
    // key 'panopticon-cli' used below — the regression this bead fixes.
    projectPath = join(root, 'repo-overdeck');
    mkdirSync(projectPath, { recursive: true });
    process.env.OVERDECK_HOME = overdeckHome;
    registry.value = [];
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves migrated: true under the registered projects.yaml key when it differs from the path basename', () => {
    expect(basename(projectPath)).toBe('repo-overdeck');
    registry.value = [{ key: 'panopticon-cli', config: { name: 'Overdeck', path: projectPath } }];
    mkdirSync(join(overdeckHome, 'state', 'panopticon-cli'), { recursive: true });
    writeFileSync(join(overdeckHome, 'state', 'panopticon-cli', 'migration-complete.json'), validMarkerJson());

    const home = resolveStateReadHomeSync({ name: 'Overdeck', path: projectPath });
    expect(home).toEqual({ root: join(overdeckHome, 'state', 'panopticon-cli'), migrated: true });
    // The pre-fix bug probed .../state/repo-overdeck/ (basename) and silently
    // resolved legacy; assert that path is NOT what we get.
    expect(home.root).not.toBe(join(overdeckHome, 'state', basename(projectPath)));
  });

  it('routes the domain read door through the registered-key root when migrated', () => {
    registry.value = [{ key: 'panopticon-cli', config: { name: 'Overdeck', path: projectPath } }];
    mkdirSync(join(overdeckHome, 'state', 'panopticon-cli'), { recursive: true });
    writeFileSync(join(overdeckHome, 'state', 'panopticon-cli', 'migration-complete.json'), validMarkerJson());

    expect(resolveStateDomainPathSync({ name: 'Overdeck', path: projectPath }, 'records'))
      .toBe(join(overdeckHome, 'state', 'panopticon-cli', 'records'));
  });

  it('falls back to basename(project.path) and legacy resolution for an unregistered project', () => {
    // No marker anywhere; project is not in the registry.
    const home = resolveStateReadHomeSync({ name: 'Overdeck', path: projectPath });
    expect(home.migrated).toBe(false);
    // resolveInfraRepo returns project.path when no pan_records.repo is set.
    expect(home.root).toBe(projectPath);
  });

  it('honors an explicit projectKey argument over the registered-key lookup', () => {
    registry.value = [{ key: 'panopticon-cli', config: { name: 'Overdeck', path: projectPath } }];
    // Marker lives under a DIFFERENT explicit key, not the registered one.
    mkdirSync(join(overdeckHome, 'state', 'explicit-key'), { recursive: true });
    writeFileSync(join(overdeckHome, 'state', 'explicit-key', 'migration-complete.json'), validMarkerJson());

    const home = resolveStateReadHomeSync({ name: 'Overdeck', path: projectPath }, 'explicit-key');
    expect(home).toEqual({ root: join(overdeckHome, 'state', 'explicit-key'), migrated: true });
    // The registered key would have won without the explicit override.
    expect(home.root).not.toBe(join(overdeckHome, 'state', 'panopticon-cli'));
  });

  it('treats an empty/non-existent marker under the resolved key as not migrated (legacy fallback)', () => {
    registry.value = [{ key: 'panopticon-cli', config: { name: 'Overdeck', path: projectPath } }];
    // Resolve the registered key but leave no marker → legacy resolution.
    const home = resolveStateReadHomeSync({ name: 'Overdeck', path: projectPath });
    expect(home.migrated).toBe(false);
    expect(home.root).toBe(projectPath);
  });

  it('shares the registered-key lookup with the canonical projectKey() (one implementation)', () => {
    registry.value = [{ key: 'panopticon-cli', config: { name: 'Overdeck', path: projectPath } }];
    const project = { name: 'Overdeck', path: projectPath } as ProjectConfig;

    // projectKey() is exported from projects.ts and reused by both the async
    // state-home door and the sync read door. Place the marker under the key
    // projectKey() resolves; if the SUT used a duplicated basename-only lookup
    // it would probe .../state/repo-overdeck and miss the marker entirely.
    expect(projectKey(project)).toBe('panopticon-cli');
    expect(projectKey(project)).not.toBe(basename(projectPath));
    mkdirSync(join(overdeckHome, 'state', projectKey(project)), { recursive: true });
    writeFileSync(join(overdeckHome, 'state', projectKey(project), 'migration-complete.json'), validMarkerJson());

    const home = resolveStateReadHomeSync(project);
    expect(home).toEqual({ root: join(getOverdeckHome(), 'state', projectKey(project)), migrated: true });
  });
});
