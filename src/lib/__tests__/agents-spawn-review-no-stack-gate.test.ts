import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PAN-4690: review reads only the committed diff, so its spawn must not gate
 * on — or rebuild — the workspace docker stack. Before the fix a review
 * dispatch tore the stack down and ran `up -d --build`; a dashboard restart in
 * that window killed the rebuild and the spawn, and the review never started.
 */
const mocks = vi.hoisted(() => ({
  getWorkspaceStackHealth: vi.fn(),
  rebuildWorkspaceStack: vi.fn(),
}));

describe('assertWorkspaceStackHealthyForSpawn — review skips the stack gate (PAN-4690)', () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetModules();
    workspace = mkdtempSync(join(tmpdir(), 'pan-4690-ws-'));
    mocks.getWorkspaceStackHealth.mockReturnValue(Effect.succeed({
      healthy: false,
      reasons: ['overdeck-feature-pan-4690-server-1 service exited (130)'],
      lastObserved: null,
    }));
    mocks.rebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: mocks.getWorkspaceStackHealth,
    }));
    vi.doMock('../workspace/rebuild-stack.js', () => ({
      rebuildWorkspaceStack: mocks.rebuildWorkspaceStack,
    }));
  });

  afterEach(() => {
    vi.doUnmock('../workspace/stack-health.js');
    vi.doUnmock('../workspace/rebuild-stack.js');
    vi.clearAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('spawns review without checking stack health or rebuilding an unhealthy stack', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    await expect(
      assertWorkspaceStackHealthyForSpawn('PAN-4690', 'review', false, workspace),
    ).resolves.toBeUndefined();

    expect(mocks.getWorkspaceStackHealth).not.toHaveBeenCalled();
    expect(mocks.rebuildWorkspaceStack).not.toHaveBeenCalled();
  });

  it('still refuses a review spawn into a missing workspace (PAN-1746)', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');
    const missing = join(tmpdir(), 'pan-4690-does-not-exist-workspace');

    await expect(
      assertWorkspaceStackHealthyForSpawn('PAN-4690', 'review', false, missing),
    ).rejects.toThrow(/does not exist/i);
  });

  it('keeps the stack gate for roles that may use the containers', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');

    await expect(
      assertWorkspaceStackHealthyForSpawn('PAN-4690', 'test', false, workspace),
    ).resolves.toBeUndefined();

    expect(mocks.getWorkspaceStackHealth).toHaveBeenCalledTimes(1);
    expect(mocks.rebuildWorkspaceStack).toHaveBeenCalledTimes(1);
  });
});
