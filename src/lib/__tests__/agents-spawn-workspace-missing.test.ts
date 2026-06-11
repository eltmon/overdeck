import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PAN-1746: a missing workspace directory must be a HARD spawn failure for
 * advancing roles, not a degrade-to-host pass. The host-fallback path in
 * assertWorkspaceStackHealthyForSpawn handles a merely-unhealthy stack, but a
 * workspace that does not exist would leave the launcher in $HOME at the
 * folder-trust prompt while holding an advancing slot.
 */
describe('assertWorkspaceStackHealthyForSpawn — missing workspace gate (PAN-1746)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Healthy stack so the only thing under test is the workspace-existence gate.
    vi.doMock('../workspace/stack-health.js', () => ({
      getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: null })),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../workspace/stack-health.js');
  });

  it('throws for an advancing role when the workspace path does not exist', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');
    const missing = join(tmpdir(), 'pan-1746-does-not-exist-workspace');
    await expect(
      assertWorkspaceStackHealthyForSpawn('PAN-1746', 'ship', false, missing),
    ).rejects.toThrow(/does not exist/i);
  });

  it('does not throw on the missing-workspace gate when the workspace exists', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');
    const workspace = mkdtempSync(join(tmpdir(), 'pan-1746-ws-'));
    try {
      await expect(
        assertWorkspaceStackHealthyForSpawn('PAN-1746', 'ship', false, workspace),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('exempts the plan role (it may create the workspace itself)', async () => {
    const { assertWorkspaceStackHealthyForSpawn } = await import('../agents.js');
    const missing = join(tmpdir(), 'pan-1746-plan-no-workspace-yet');
    await expect(
      assertWorkspaceStackHealthyForSpawn('PAN-1746', 'plan', false, missing),
    ).resolves.toBeUndefined();
  });
});
