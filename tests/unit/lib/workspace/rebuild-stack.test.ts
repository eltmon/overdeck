import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const calls: string[][] = [];
let responses: Record<string, string | Error>;

vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push([cmd, ...args]);
    const key = args.join(' ');
    const match = Object.entries(responses).find(([k]) => key.startsWith(k));
    if (!match) return cb(null, { stdout: '', stderr: '' });
    const value = match[1];
    if (value instanceof Error) return cb(value, { stdout: '', stderr: '' });
    return cb(null, { stdout: value, stderr: '' });
  },
  // PAN-3917: pr-facts imports `exec` at module load; the mock must supply it.
  exec: (_cmd: string, _opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb?.(null, { stdout: '', stderr: '' });
    return { on: () => {} };
  },
}));

const mocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  ensureDevcontainer: vi.fn(),
  getPrFacts: vi.fn(),
  reserveDiskFloor: vi.fn(),
  release: vi.fn(),
  estimateWorkspaceDiskCost: vi.fn(),
}));

// PAN-4961: admission reads real statfs and the estimator runs git/docker.
vi.mock('../../../../src/lib/disk-floor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/disk-floor.js')>()),
  reserveDiskFloor: mocks.reserveDiskFloor,
}));

vi.mock('../../../../src/lib/workspace/disk-cost.js', () => ({
  estimateWorkspaceDiskCost: mocks.estimateWorkspaceDiskCost,
  invalidateWorkspaceDiskCostMemo: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));

vi.mock('../../../../src/lib/docker-stats.js', () => ({
  getCachedDockerContainerLifecycleObservedAt: () => null,
  getCachedDockerContainerLifecycleSnapshot: () => [],
  recordDockerContainerLifecycleSnapshot: vi.fn(),
}));

vi.mock('../../../../src/lib/workspace/ensure-devcontainer.js', () => ({
  ensureDevcontainer: mocks.ensureDevcontainer,
}));

// PAN-3917: the terminal guard asks the forge; keep the subprocess out.
// (was: review-status.ts, deleted with the row plane)
vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
}));

import { DISK_LOW_HELD_PREFIX } from '../../../../src/lib/disk-floor.js';
import { rebuildWorkspaceStack } from '../../../../src/lib/workspace/rebuild-stack.js';

let tmpRoot: string | null = null;

function makeWorkspace(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-rebuild-resolve-after-render-'));
  const workspacePath = join(tmpRoot, 'workspaces', 'feature-min-901');
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

function writeComposeFile(workspacePath: string, content: string): void {
  const devcontainerDir = join(workspacePath, '.devcontainer');
  mkdirSync(devcontainerDir, { recursive: true });
  writeFileSync(join(devcontainerDir, 'docker-compose.devcontainer.yml'), content);
}

function setupProject(workspacePath: string): void {
  const projectPath = workspacePath.replace(/\/workspaces\/feature-[^/]+$/, '');
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'myn', projectPath });
  mocks.getProjectSync.mockReturnValue({
    name: 'myn',
    path: projectPath,
    workspace: {
      workspaces_dir: 'workspaces',
      docker: { compose_template: 'infra/.devcontainer-template/docker-compose.devcontainer.yml' },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  responses = {};
  mocks.getPrFacts.mockResolvedValue({ merged: false });
  mocks.isIssueClosed.mockResolvedValue(false);
  mocks.release.mockResolvedValue(undefined);
  mocks.reserveDiskFloor.mockResolvedValue({ ok: true, reservation: { release: mocks.release } });
  mocks.estimateWorkspaceDiskCost.mockResolvedValue({ hostBytes: 1, stackBytes: 2_000, hostSource: 'measured', stackSource: 'measured' });
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

function composeCalls(subcommand: 'up' | 'down'): string[][] {
  return calls.filter((c) => c[0] === 'docker' && c[1] === 'compose' && c.includes(subcommand));
}

describe('rebuildWorkspaceStack — resolve name after render (PAN-3049)', () => {
  it('ac1: brings a freshly rendered workspace up under the declared name, not the fallback', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    // No .devcontainer at all yet — mirrors a spawn-time rebuild on a brand-new workspace.
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    expect(result.composeProjectName).toBe('myn-feature-min-901');
    const upCalls = composeCalls('up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0]).toContain('myn-feature-min-901');
    expect(upCalls[0]).not.toContain('overdeck-feature-min-901');
  });

  it('ac2: tears down the workspace\'s own current (fallback-named) stack before re-rendering, and never touches it again after render', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    // Pre-existing render with no declared name anywhere — resolves to the overdeck- fallback.
    writeComposeFile(workspacePath, 'services:\n  api:\n    image: test\n');
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    const downCalls = composeCalls('down');
    // Exactly one teardown: the pre-render pass on the workspace's own
    // current compose file, under its then-current (fallback) name. There is
    // no second, post-render teardown of the now-stale name — that proactive
    // sweep was removed (review fix): guessing a name is safe to stop is
    // exactly the fail-open pattern a transient Docker error or a
    // restarting/paused stack could slip through.
    expect(downCalls).toHaveLength(1);
    expect(downCalls[0]).toContain('overdeck-feature-min-901');
    expect(downCalls[0]).not.toContain('myn-feature-min-901');
    const upCalls = composeCalls('up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0]).toContain('myn-feature-min-901');
  });

  it('leaves a running foreign-prefixed stack untouched instead of stopping it automatically', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    // No pre-existing .devcontainer — mirrors a spawn-time rebuild where the
    // fallback-named stack was brought up by another process (e.g.
    // spawn-prep.ts) before this render ever ran, so it is genuinely live.
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });
    responses['ps -a --format'] = [
      JSON.stringify({
        ID: 'abc123',
        Names: 'overdeck-feature-min-901-api-1',
        Status: 'Up 5 minutes',
        State: 'running',
        Labels: 'com.docker.compose.project=overdeck-feature-min-901',
      }),
    ].join('\n');

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    // No pre-existing compose file, so there is no pre-render teardown call,
    // and there is no post-render stale-name teardown at all (removed) — a
    // running foreign-prefixed stack is never a `down` candidate regardless
    // of what Docker reports.
    expect(composeCalls('down')).toHaveLength(0);
    const upCalls = composeCalls('up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0]).toContain('myn-feature-min-901');
  });

  it('review fix: a conflicting pre-render declaration is never converted into a guessed teardown target', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    // The CURRENT devcontainer declares a name that does not end in this
    // workspace's feature folder — composeProjectNameForWorkspace throws
    // rather than returning a guess. The old code swallowed that via
    // tryComposeProjectNameForWorkspace(...) ?? fallback and ran `down`
    // against the guessed fallback name anyway; that must not happen.
    writeComposeFile(workspacePath, 'name: victim-project\nservices:\n  api:\n    image: test\n');
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    // No pre-render teardown at all — the conflicting declaration means the
    // real running project (if any) is unknown, so nothing is guessed.
    expect(composeCalls('down')).toHaveLength(0);
    const upCalls = composeCalls('up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0]).toContain('myn-feature-min-901');
  });

  it('ac3: fails loudly instead of starting a stack under the fallback when no name is resolvable', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, 'services:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot resolve compose project name for workspace');
    expect(composeCalls('up')).toHaveLength(0);
  });
});

describe('rebuildWorkspaceStack — disk admission (PAN-4961)', () => {
  const HELD = `${DISK_LOW_HELD_PREFIX}: 11.0 GiB free on the filesystem holding /x, 0.0 GiB reserved by 0 in-flight workspace setup(s), this step needs 2.0 GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.`;

  function prepareRenderedWorkspace(): string {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    const compose = 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n';
    writeComposeFile(workspacePath, compose);
    mocks.ensureDevcontainer.mockImplementation(() => {
      writeComposeFile(workspacePath, compose);
      return { step: { success: true } };
    });
    return workspacePath;
  }

  it('stack-admission.ac1: a refused admission returns diskLow and never runs up', async () => {
    prepareRenderedWorkspace();
    mocks.reserveDiskFloor.mockResolvedValue({ ok: false, error: HELD });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(false);
    expect(result.diskLow).toBe(true);
    expect(result.error?.startsWith('Disk low — new workspace starts are held')).toBe(true);
    expect(composeCalls('up')).toHaveLength(0);
  });

  it('stack-admission.ac2: releases once after a successful up', async () => {
    prepareRenderedWorkspace();

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    expect(composeCalls('up')).toHaveLength(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('stack-admission.ac3: releases once after a failing up', async () => {
    const workspacePath = prepareRenderedWorkspace();
    const composeFile = join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml');
    responses[`compose -f ${composeFile} -p myn-feature-min-901 up`] = new Error('compose up exploded');

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('compose up exploded');
    expect(result.diskLow).toBeUndefined();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('stack-admission.ac4: reserves the stack bytes after the down -v teardown', async () => {
    const workspacePath = prepareRenderedWorkspace();
    let downCallsAtReserve = -1;
    mocks.reserveDiskFloor.mockImplementation(async () => {
      downCallsAtReserve = composeCalls('down').length;
      return { ok: true, reservation: { release: mocks.release } };
    });

    await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(composeCalls('down')).toHaveLength(1);
    expect(downCallsAtReserve).toBe(1);
    expect(mocks.reserveDiskFloor).toHaveBeenCalledWith({ path: workspacePath, bytes: 2_000, label: 'stack:min-901' });
  });
});
