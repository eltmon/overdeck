import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

import { composeProjectNameForWorkspace, rebuildWorkspaceStack } from '../rebuild-stack.js';

const mocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  getPrFacts: vi.fn(),
  ensureDevcontainer: vi.fn(),
  collectDockerContainerLifecycleSnapshot: vi.fn(() => []),
  recordDockerContainerLifecycleSnapshot: vi.fn(),
  reconcileTraefikNetworks: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../cloister/issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

// PAN-3917: "did this issue's PR merge?" is the forge's answer.
vi.mock('../../cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));

vi.mock('../../docker-stats.js', () => ({
  recordDockerContainerLifecycleSnapshot: mocks.recordDockerContainerLifecycleSnapshot,
}));

vi.mock('./stack-health.js', () => ({
  collectDockerContainerLifecycleSnapshot: mocks.collectDockerContainerLifecycleSnapshot,
}));

vi.mock('./traefik-connect.js', () => ({
  reconcileTraefikNetworks: mocks.reconcileTraefikNetworks,
}));

vi.mock('./ensure-devcontainer.js', () => ({
  ensureDevcontainer: mocks.ensureDevcontainer,
}));

let tmpRoot: string | null = null;

function makeWorkspace(devScript: string | null): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-rebuild-stack-'));
  const workspacePath = join(tmpRoot, 'workspaces', 'feature-min-831');
  const devcontainerPath = join(workspacePath, '.devcontainer');
  mkdirSync(devcontainerPath, { recursive: true });
  if (devScript !== null) {
    writeFileSync(join(devcontainerPath, 'dev'), devScript);
  }
  return workspacePath;
}

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe('composeProjectNameForWorkspace', () => {
  it('uses a project-specific compose prefix declared by the workspace dev script', () => {
    const workspacePath = makeWorkspace('FEATURE_FOLDER="feature-min-831"\nexport COMPOSE_PROJECT_NAME="myn-${FEATURE_FOLDER}"\n');

    expect(composeProjectNameForWorkspace(workspacePath, 'MIN-831')).toBe('myn-feature-min-831');
  });

  it('falls back to the legacy overdeck compose prefix when no dev script declares one', () => {
    const workspacePath = makeWorkspace(null);

    expect(composeProjectNameForWorkspace(workspacePath, 'PAN-1140')).toBe('overdeck-feature-pan-1140');
  });

  it('refuses a compose project name that does not target the workspace feature folder', () => {
    const workspacePath = makeWorkspace('export COMPOSE_PROJECT_NAME="victim-project"\n');

    expect(() => composeProjectNameForWorkspace(workspacePath, 'MIN-831')).toThrow(
      'declares COMPOSE_PROJECT_NAME=victim-project, expected a name ending in feature-min-831',
    );
  });
});

describe('rebuildWorkspaceStack terminal-state guard (PAN-2510)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrFacts.mockResolvedValue({ merged: false });
  });

  function setupProject(workspacePath: string) {
    const projectPath = workspacePath.replace(/\/workspaces\/feature-[^/]+$/, '');
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'myn',
      projectPath,
    });
    mocks.getProjectSync.mockReturnValue({
      name: 'myn',
      path: projectPath,
      workspace: {
        workspaces_dir: 'workspaces',
        docker: {
          compose_template: 'infra/.devcontainer-template/docker-compose.devcontainer.yml',
        },
      },
    });
  }

  it('returns terminal error and skips rebuild when the issue is closed', async () => {
    const workspacePath = makeWorkspace(null);
    setupProject(workspacePath);
    mocks.isIssueClosed.mockResolvedValue(true);

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-831'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('terminal');
    expect(mocks.ensureDevcontainer).not.toHaveBeenCalled();
  });

  it('blocks an open issue whose PR the forge reports merged', async () => {
    const workspacePath = makeWorkspace(null);
    setupProject(workspacePath);
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.getPrFacts.mockResolvedValue({ merged: true });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-831'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('terminal');
    expect(mocks.ensureDevcontainer).not.toHaveBeenCalled();
  });

  it('proceeds past the guard when neither the issue nor its PR is terminal', async () => {
    const workspacePath = makeWorkspace(null);
    setupProject(workspacePath);
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.ensureDevcontainer.mockReturnValue({
      step: { success: true },
    });

    const result = await Effect.runPromise(rebuildWorkspaceStack('MIN-831'));

    expect(result.error).not.toContain('terminal');
  });

  it('evaluates the guard asynchronously inside Effect.gen', async () => {
    const workspacePath = makeWorkspace(null);
    setupProject(workspacePath);
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(Effect.runPromise(rebuildWorkspaceStack('MIN-831'))).resolves.not.toThrow();
  });
});
