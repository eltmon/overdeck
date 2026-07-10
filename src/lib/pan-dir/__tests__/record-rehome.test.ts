/**
 * PAN-2372 WI-2 / FR-3: the workspace record door resolves the owning project
 * and delegates to the canonical, migration-aware path resolver.
 *
 * The canonical door (writeStatusOverridesSync / writeIssueRecordSync via
 * getIssueRecordPath) and the workspace door (readIssueRecordForWorkspaceSync /
 * getIssueRecordPathForWorkspace) must hit the SAME file on a migrated project;
 * unmigrated-registered and unregistered projects keep the byte-identical
 * `<workspace>/.pan/records/<issue>.json` path.
 *
 * PROJECTS_CONFIG_FILE is captured at module load, so listProjectsSync cannot be
 * steered via OVERDECK_HOME; we mock ../projects.js to drive project resolution
 * and migration-key lookup together, keep resolveInfraRepo real for the legacy
 * fallback, and stub queueAutoCommit so no real git commit fires.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectConfig, ResolvedProject } from '../../projects.js';

type RegisteredProject = { key: string; config: ProjectConfig };

const registry = vi.hoisted(() => ({
  projects: [] as RegisteredProject[],
  resolved: {} as Record<string, ResolvedProject>,
  configs: {} as Record<string, ProjectConfig>,
  queueAutoCommit: vi.fn(),
}));

vi.mock('../../projects.js', async (importActual) => {
  const actual = await importActual<typeof import('../../projects.js')>();
  return {
    ...actual,
    listProjectsSync: () => registry.projects,
    resolveProjectFromIssueSync: (issueId: string): ResolvedProject | null => registry.resolved[issueId] ?? null,
    getProjectSync: (key: string): ProjectConfig | null => registry.configs[key] ?? null,
  };
});

vi.mock('../auto-commit.js', async (importActual) => {
  const actual = await importActual<typeof import('../auto-commit.js')>();
  return { ...actual, queueAutoCommit: registry.queueAutoCommit };
});

import {
  getIssueRecordPathForWorkspace,
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
  writeStatusOverridesSync,
  type PanIssueRecord,
} from '../record.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function markerJson(): string {
  return JSON.stringify({ sourceMainSha: SHA_A, stateBranchSha: SHA_B, completedAt: '2026-07-09T20:00:00.000Z', version: 1 });
}

function pipeline(issueId: string): PanIssueRecord['pipeline'] {
  return { issueId, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-07-10T00:00:00.000Z' };
}

describe('PAN-2372 WI-2 workspace record door re-home (FR-3)', () => {
  let root: string;
  let overdeckHome: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-record-rehome-'));
    overdeckHome = join(root, 'overdeck-home');
    mkdirSync(overdeckHome, { recursive: true });
    process.env.OVERDECK_HOME = overdeckHome;
    registry.projects = [];
    registry.resolved = {};
    registry.configs = {};
    registry.queueAutoCommit.mockClear();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  /** Register a project and a valid migration marker under its state key. */
  function registerMigratedProject(issueId: string, key: string): { projectPath: string; workspacePath: string; project: ProjectConfig } {
    const projectPath = join(root, key, 'repo');
    mkdirSync(projectPath, { recursive: true });
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    const config: ProjectConfig = { name: key, path: projectPath };
    registry.projects = [{ key, config }];
    registry.resolved[issueId] = { projectKey: key, projectName: key, projectPath };
    registry.configs[key] = config;
    mkdirSync(join(overdeckHome, 'state', key), { recursive: true });
    writeFileSync(join(overdeckHome, 'state', key, 'migration-complete.json'), markerJson());
    return { projectPath, workspacePath, project: config };
  }

  it('converges the canonical and workspace doors on the same migrated state-home file', () => {
    const ISSUE_ID = 'PAN-2372';
    const KEY = 'migrated-proj';
    const { workspacePath, project } = registerMigratedProject(ISSUE_ID, KEY);

    // Canonical door write (the merge path's mirrorTaskOperationToRecord route).
    writeStatusOverridesSync(project, ISSUE_ID, { 'item-1': 'completed', 'item-2': 'completed' });

    // Workspace door read must return the SAME record (the pre-fix bug read a
    // different, slot-local file and never saw the merged overrides).
    const viaWorkspace = readIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID);
    expect(viaWorkspace?.statusOverrides).toEqual({ 'item-1': 'completed', 'item-2': 'completed' });

    // The record lives under the migrated state home, NOT the slot worktree.
    const migratedPath = join(overdeckHome, 'state', KEY, 'records', `${ISSUE_ID.toLowerCase()}.json`);
    expect(existsSync(migratedPath)).toBe(true);
    expect(existsSync(join(workspacePath, '.pan', 'records', `${ISSUE_ID.toLowerCase()}.json`))).toBe(false);
  });

  it('queues a state commit when writeIssueRecordForWorkspaceSync writes for a resolvable project', () => {
    const ISSUE_ID = 'PAN-2372';
    const KEY = 'migrated-proj';
    const { workspacePath } = registerMigratedProject(ISSUE_ID, KEY);
    registry.queueAutoCommit.mockClear();

    const record = {
      issueId: ISSUE_ID,
      schemaVersion: 2,
      statusOverrides: { 'item-1': 'completed' },
      pipeline: pipeline(ISSUE_ID),
    } as PanIssueRecord;

    writeIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID, record);
    expect(registry.queueAutoCommit).toHaveBeenCalledTimes(1);
    const call = registry.queueAutoCommit.mock.calls[0][0];
    expect(call.subject).toContain(ISSUE_ID.toUpperCase());
    expect(call.paths[0]).toBe(join(overdeckHome, 'state', KEY, 'records', `${ISSUE_ID.toLowerCase()}.json`));
  });

  it('resolves the byte-identical legacy workspace path for an unmigrated registered project', () => {
    const ISSUE_ID = 'PAN-9999';
    const KEY = 'legacy-proj';
    const projectPath = join(root, KEY, 'repo');
    mkdirSync(projectPath, { recursive: true });
    const workspacePath = join(projectPath, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    const config: ProjectConfig = { name: KEY, path: projectPath };
    registry.projects = [{ key: KEY, config }];
    registry.resolved[ISSUE_ID] = { projectKey: KEY, projectName: KEY, projectPath };
    registry.configs[KEY] = config;
    // No migration marker → unmigrated.

    const legacy = join(workspacePath, '.pan', 'records', `${ISSUE_ID.toLowerCase()}.json`);
    expect(getIssueRecordPathForWorkspace(workspacePath, ISSUE_ID)).toBe(legacy);
  });

  it('falls back to <workspace>/.pan/records/ and round-trips when no project is resolvable (no commit queued)', () => {
    const ISSUE_ID = 'NOPE-1';
    const workspacePath = join(root, 'lonely-workspace');
    mkdirSync(workspacePath, { recursive: true });
    // resolveProjectFromIssueSync returns null for an unregistered issue.

    const fallback = join(workspacePath, '.pan', 'records', `${ISSUE_ID.toLowerCase()}.json`);
    expect(getIssueRecordPathForWorkspace(workspacePath, ISSUE_ID)).toBe(fallback);

    const record = {
      issueId: ISSUE_ID,
      schemaVersion: 2,
      statusOverrides: { 'x': 'done' },
      pipeline: pipeline(ISSUE_ID),
    } as PanIssueRecord;

    registry.queueAutoCommit.mockClear();
    writeIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID, record);
    // Unresolvable project → no owning project to commit on behalf of.
    expect(registry.queueAutoCommit).not.toHaveBeenCalled();
    expect(readIssueRecordForWorkspaceSync(workspacePath, ISSUE_ID)?.statusOverrides).toEqual({ 'x': 'done' });
  });
});
