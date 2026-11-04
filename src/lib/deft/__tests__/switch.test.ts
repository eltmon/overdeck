/**
 * PAN-4820 WI-13: switching an issue onto Deft's pipeline and back, with
 * injected deps that record the order of operations.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DeftInstallResult } from '../install.js';
import type { DeftInstallSnapshot } from '../install-snapshot.js';
import { backToOverdeck, DEFT_PLACEHOLDER_TITLE, type DeftSwitchDeps, DeftSwitchError, useDeftPipeline } from '../switch.js';

const scratch = mkdtempSync(join(tmpdir(), 'deft-switch-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const snapshot: DeftInstallSnapshot = {
  version: 1,
  issueId: 'TST-1',
  installedAt: '2026-11-02T00:00:00Z',
  runtimeVersion: '0.127.0',
  createdPaths: ['AGENTS.md', '.githooks/'],
  modifiedTracked: [{ path: 'package.json', restoreContentB64: '', postInstallSha256: '', baseBlob: '' }],
  modifiedUntracked: [],
  touchedPreexisting: [],
  sharedHooksPathBefore: null,
  excludeFile: '/x',
};

function recorder(overrides: Partial<DeftSwitchDeps> = {}) {
  const calls: string[] = [];
  const deps: DeftSwitchDeps = {
    resolveProject: () => ({ projectKey: 'tst', projectPath: '/repo/tst', polyrepo: false }),
    isRemote: () => false,
    workspacePath: () => '/repo/tst/workspaces/feature-tst-1',
    stopAgents: async () => { calls.push('stop'); },
    setPipeline: async (_issue, pipeline) => { calls.push(`setPipeline(${pipeline})`); },
    workspaceExists: async () => true,
    createWorkspace: async () => { calls.push('createWorkspace'); },
    install: async () => { calls.push('install'); return { ok: true, mode: 'installed', snapshot, alreadyInstalled: false }; },
    remove: async () => { calls.push('remove'); return { removed: ['AGENTS.md'], restored: ['package.json'], refused: [] }; },
    save: async () => { calls.push('save'); return { committed: true, sha: 'abc123', files: 2 }; },
    nativeDirective: async () => false,
    hasSnapshot: async () => true,
    findPlanPath: async () => '/plan.json',
    writePlaceholderPlan: async () => { calls.push('writePlaceholderPlan'); },
    ...overrides,
  };
  return { calls, deps };
}

describe('useDeftPipeline', () => {
  it('stops agents, records the pipeline, installs, and reports the hidden paths', async () => {
    const { calls, deps } = recorder();

    const result = await useDeftPipeline('tst-1', deps);

    expect(calls).toEqual(['stop', 'setPipeline(deft)', 'install']);
    expect(result).toEqual({
      mode: 'temporary-install',
      snapshotPaths: ['AGENTS.md', '.githooks/', 'package.json'],
      workspace: '/repo/tst/workspaces/feature-tst-1',
      placeholderPlan: false,
    });
  });

  it('creates a missing workspace and writes the stand-in plan when none exists', async () => {
    const { calls, deps } = recorder({ workspaceExists: async () => false, findPlanPath: async () => null });

    const result = await useDeftPipeline('TST-1', deps);

    expect(calls).toEqual(['stop', 'setPipeline(deft)', 'createWorkspace', 'install', 'writePlaceholderPlan']);
    expect(result.placeholderPlan).toBe(true);
  });

  it('undoes the install and resets the pipeline when the install fails, then rethrows', async () => {
    const failed: DeftInstallResult = { ok: false, error: 'directive install failed: boom', snapshot };
    const { calls, deps } = recorder({ install: async () => { calls.push('install'); return failed; } });

    await expect(useDeftPipeline('TST-1', deps)).rejects.toThrow('directive install failed: boom');
    expect(calls).toEqual(['stop', 'setPipeline(deft)', 'install', 'remove', 'setPipeline(overdeck)']);
  });

  it('resets the pipeline without an undo when the failed install left nothing', async () => {
    const { calls, deps } = recorder({
      install: async () => { calls.push('install'); return { ok: false, error: 'directive install failed: refused' }; },
      hasSnapshot: async () => false,
    });

    await expect(useDeftPipeline('TST-1', deps)).rejects.toThrow('refused');
    expect(calls).toEqual(['stop', 'setPipeline(deft)', 'install', 'setPipeline(overdeck)']);
  });

  it('refuses a polyrepo project and changes nothing', async () => {
    const { calls, deps } = recorder({ resolveProject: () => ({ projectKey: 'tst', projectPath: '/repo/tst', polyrepo: true }) });

    await expect(useDeftPipeline('TST-1', deps)).rejects.toBeInstanceOf(DeftSwitchError);
    await expect(useDeftPipeline('TST-1', deps)).rejects.toThrow(
      'TST-1 is in a polyrepo workspace; running an issue on Deft supports single-repo workspaces only',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a remote workspace and changes nothing', async () => {
    const { calls, deps } = recorder({ isRemote: () => true });

    await expect(useDeftPipeline('TST-1', deps)).rejects.toThrow('supports local workspaces only');
    expect(calls).toEqual([]);
  });

  it('marks the stand-in plan it writes with deftPlaceholder', async () => {
    const projectPath = mkdtempSync(join(scratch, 'project-'));
    const { deps } = recorder({ findPlanPath: async () => null, writePlaceholderPlan: undefined });

    await useDeftPipeline('TST-1', { ...deps, resolveProject: () => ({ projectKey: 'tst', projectPath, polyrepo: false }) });

    const specs = readdirSync(join(projectPath, '.pan', 'specs'));
    expect(specs).toHaveLength(1);
    const plan = JSON.parse(readFileSync(join(projectPath, '.pan', 'specs', specs[0] ?? ''), 'utf8')) as {
      plan: { title: string; metadata: Record<string, unknown> };
    };
    expect(plan.plan.title).toBe(DEFT_PLACEHOLDER_TITLE);
    expect(plan.plan.metadata.deftPlaceholder).toBe(true);
  });
});

describe('backToOverdeck', () => {
  function planFile(metadata: Record<string, unknown>): string {
    const dir = mkdtempSync(join(scratch, 'plan-'));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'plan.xbrief.json');
    writeFileSync(path, JSON.stringify({ plan: { id: 'TST-1', metadata } }));
    return path;
  }

  it('stops, saves, removes, then resets the pipeline, and points at pan start', async () => {
    const { calls, deps } = recorder({ findPlanPath: async () => null });

    const result = await backToOverdeck('tst-1', deps);

    expect(calls).toEqual(['stop', 'save', 'remove', 'setPipeline(overdeck)']);
    expect(result).toEqual({ removed: ['AGENTS.md'], restored: ['package.json'], archiveSha: 'abc123', next: 'pan start TST-1' });
  });

  it('reports a missing snapshot from the undo', async () => {
    const { deps } = recorder({
      findPlanPath: async () => null,
      remove: async () => ({ removed: [], restored: [], refused: [], snapshotMissing: true, unhidden: ['package.json'] }),
    });

    expect(await backToOverdeck('TST-1', deps)).toMatchObject({ snapshotMissing: true, unhidden: ['package.json'], next: 'pan start TST-1' });
  });

  it('skips the save for a native Directive project', async () => {
    const { calls, deps } = recorder({ nativeDirective: async () => true, findPlanPath: async () => null });

    expect((await backToOverdeck('TST-1', deps)).archiveSha).toBeNull();
    expect(calls).toEqual(['stop', 'remove', 'setPipeline(overdeck)']);
  });

  it('deletes the plan only when it carries the Deft stand-in marker', async () => {
    const placeholder = planFile({ deftPlaceholder: true });
    const real = planFile({ canonicalFilename: 'x' });

    await backToOverdeck('TST-1', recorder({ findPlanPath: async () => placeholder }).deps);
    await backToOverdeck('TST-1', recorder({ findPlanPath: async () => real }).deps);

    expect(existsSync(placeholder)).toBe(false);
    expect(existsSync(real)).toBe(true);
  });
});
