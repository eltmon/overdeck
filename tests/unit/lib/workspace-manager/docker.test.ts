import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

let tmpRoot: string | null = null;

function makeWorkspace(devScript?: string): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pan-stop-docker-'));
  const workspacePath = join(tmpRoot, 'workspaces', 'feature-min-901');
  const devcontainerPath = join(workspacePath, '.devcontainer');
  mkdirSync(devcontainerPath, { recursive: true });
  writeFileSync(join(devcontainerPath, 'docker-compose.devcontainer.yml'), 'services:\n  api:\n    image: test\n');
  if (devScript !== undefined) {
    writeFileSync(join(devcontainerPath, 'dev'), devScript);
  }
  return workspacePath;
}

async function loadStopDocker() {
  const { stopWorkspaceDockerPromise } = await import('../../../../src/lib/workspace-manager/docker.js');
  return stopWorkspaceDockerPromise;
}

// Normalizes both invocation shapes this module uses: execAsync(shellString,
// opts) and, since PAN-3049's command-injection fix, execFileAsync(cmd,
// argsArray, opts) for calls that carry workspace-controlled content.
function commandsOf(): string[] {
  return mockExecAsync.mock.calls.map(([first, second]) => {
    if (typeof first === 'string' && Array.isArray(second)) return [first, ...second].join(' ');
    return typeof first === 'string' ? first : first?.cmd;
  });
}

describe('stopWorkspaceDockerPromise — canonical resolver (PAN-3049)', () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  });

  it('ac1: tears down with the declared project name and does not throw', async () => {
    const workspacePath = makeWorkspace('FEATURE_FOLDER="feature-min-901"\nexport COMPOSE_PROJECT_NAME="myn-${FEATURE_FOLDER}"\n');
    const stopDocker = await loadStopDocker();

    await expect(stopDocker(workspacePath, 'min-901')).resolves.not.toThrow();
    expect(commandsOf()).toContain('docker compose -f ' + join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml') + ' -p myn-feature-min-901 down -v --remove-orphans');
  });

  it('ac2: falls back to the overdeck- prefix when nothing declares a name', async () => {
    const workspacePath = makeWorkspace();
    const stopDocker = await loadStopDocker();

    await stopDocker(workspacePath, 'min-901');

    expect(commandsOf()).toContain('docker compose -f ' + join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml') + ' -p overdeck-feature-min-901 down -v --remove-orphans');
  });

  it('passes the compose project name as an argv entry, never interpolated into a shell string', async () => {
    const workspacePath = makeWorkspace('export COMPOSE_PROJECT_NAME="myn-feature-min-901"\n');
    const stopDocker = await loadStopDocker();

    await stopDocker(workspacePath, 'min-901');

    const execFileCalls = mockExecAsync.mock.calls.filter(
      ([first, second]) => typeof first === 'string' && Array.isArray(second),
    );
    expect(execFileCalls.length).toBeGreaterThan(0);
    for (const [cmd, args] of execFileCalls) {
      expect(cmd).toBe('docker');
      expect(args).not.toEqual(expect.arrayContaining([expect.stringContaining('$(')]));
      // Every arg is its own array element — none is a shell-assembled string
      // containing the full compose invocation.
      for (const arg of args as string[]) {
        expect(arg).not.toMatch(/^docker /);
      }
    }
  });

  it('propagates the resolver mismatch error instead of silently tearing down the wrong stack', async () => {
    const workspacePath = makeWorkspace('export COMPOSE_PROJECT_NAME="victim-project"\n');
    const stopDocker = await loadStopDocker();

    await expect(stopDocker(workspacePath, 'min-901')).rejects.toThrow(
      'declares COMPOSE_PROJECT_NAME=victim-project, expected a name ending in feature-min-901',
    );
  });
});
