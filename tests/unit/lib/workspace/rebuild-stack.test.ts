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
}));

const mocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  ensureDevcontainerSync: vi.fn(),
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
  ensureDevcontainerSync: mocks.ensureDevcontainerSync,
}));

import { rebuildWorkspaceStack } from '../../../../src/lib/workspace/rebuild-stack.js';
import {
  registerCanonicalReviewStatusResolver,
  registerReviewStatusMapReader,
} from '../../../../src/lib/cloister/review-status-source.js';

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
  registerReviewStatusMapReader(() => ({}));
  registerCanonicalReviewStatusResolver(() => null);
  mocks.isIssueClosed.mockResolvedValue(false);
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
    mocks.ensureDevcontainerSync.mockImplementation(() => {
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

  it('ac2: tears down the stale fallback-named stack in addition to the declared-name pass', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    // Pre-existing render with no declared name anywhere — resolves to the overdeck- fallback.
    writeComposeFile(workspacePath, 'services:\n  api:\n    image: test\n');
    mocks.ensureDevcontainerSync.mockImplementation(() => {
      writeComposeFile(workspacePath, 'name: myn-feature-min-901\nservices:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(true);
    const downCalls = composeCalls('down');
    // One teardown before the re-render (existing compose file) and one more
    // after render because the declared name changed — both under the stale
    // fallback name, never the freshly declared one.
    expect(downCalls).toHaveLength(2);
    for (const call of downCalls) {
      expect(call).toContain('overdeck-feature-min-901');
      expect(call).not.toContain('myn-feature-min-901');
    }
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
    mocks.ensureDevcontainerSync.mockImplementation(() => {
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
    // No pre-existing compose file, so there is no pre-render teardown call —
    // the only down candidate is the post-render stale-name sweep, which must
    // NOT fire against a stack confirmed running.
    expect(composeCalls('down')).toHaveLength(0);
    const upCalls = composeCalls('up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0]).toContain('myn-feature-min-901');
  });

  it('ac3: fails loudly instead of starting a stack under the fallback when no name is resolvable', async () => {
    const workspacePath = makeWorkspace();
    setupProject(workspacePath);
    mocks.ensureDevcontainerSync.mockImplementation(() => {
      writeComposeFile(workspacePath, 'services:\n  api:\n    image: test\n');
      return { step: { success: true } };
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-901'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot resolve compose project name for workspace');
    expect(composeCalls('up')).toHaveLength(0);
  });
});
