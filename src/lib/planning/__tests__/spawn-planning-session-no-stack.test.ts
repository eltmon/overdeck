/**
 * PAN-4961 WI-8: planning builds no Docker stack. The stacks seen beside
 * planning sessions came from the finalize auto-handoff's work spawn, so pin
 * both halves: a planning spawn asks createWorkspace for no stack, and the
 * spawn-time stack gate returns at once for the plan role.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  getWorkspaceStackHealth: vi.fn(),
  rebuildWorkspaceStack: vi.fn(),
}));

vi.mock('../../workspace-manager.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace-manager.js')>()),
  createWorkspace: mocks.createWorkspace,
}));

vi.mock('../../projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../projects.js')>()),
  findProjectByPath: vi.fn(() => ({ name: 'Test', path: '/projects/test', workspace: { type: 'monorepo' } })),
}));

vi.mock('../../workspace/stack-health.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace/stack-health.js')>()),
  getWorkspaceStackHealth: mocks.getWorkspaceStackHealth,
}));

vi.mock('../../workspace/rebuild-stack.js', () => ({
  rebuildWorkspaceStack: mocks.rebuildWorkspaceStack,
}));

import { spawnPlanningSession } from '../spawn-planning-session.js';
import { assertWorkspaceStackHealthyForSpawn } from '../../agents/spawn-prep.js';

let tempHome: string;
let prevHome: string | undefined;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  tempHome = mkdtempSync(join(tmpdir(), 'pan-4961-plan-home-'));
  prevHome = process.env.HOME;
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = tempHome;
  process.env.OVERDECK_HOME = join(tempHome, '.overdeck');
  // Stop the spawn right after workspace creation; only its arguments matter.
  mocks.createWorkspace.mockResolvedValue({ success: false, workspacePath: '', errors: ['stop after create'], steps: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('planning creates no Docker stack (PAN-4961)', () => {
  it('planning-no-stack-test.ac1: a planning spawn without startDocker asks createWorkspace for no stack', async () => {
    const result = await spawnPlanningSession({
      issue: {
        id: 'PAN-1',
        identifier: 'PAN-1',
        title: 'Plan without a stack',
        description: 'test',
        url: 'https://github.com/eltmon/overdeck/issues/1',
        source: 'github',
      },
      workspacePath: join(tempHome, 'workspaces', 'feature-pan-1'),
      projectPath: '/projects/test',
      sessionName: 'planning-pan-1',
      workspaceLocation: 'local',
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      startedBy: 'test',
    });

    expect(result.success).toBe(false);
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkspace.mock.calls[0][0].startDocker).toBeFalsy();
  });

  it('planning-no-stack-test.ac2: the spawn stack gate returns at once for the plan role', async () => {
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-1', 'plan')).resolves.toBeUndefined();

    expect(mocks.getWorkspaceStackHealth).not.toHaveBeenCalled();
    expect(mocks.rebuildWorkspaceStack).not.toHaveBeenCalled();
  });
});
