import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRestartBlockReason } from '../../../../src/lib/deploy/agent-restart-gate.js';
import { readPendingDeploy } from '../../../../src/lib/deploy/deploy-queue.js';
import type { DeployWindowDependencies } from '../../../../src/lib/deploy/deploy-window.js';

function clearDependencies() {
  return {
    isMergeAgentRunning: vi.fn(async () => false),
    pendingPostMergeExists: vi.fn(async () => false),
    readRestartLockHolder: vi.fn(async () => null),
    readDevSupervisorMarker: vi.fn(() => null),
  } satisfies DeployWindowDependencies;
}

function expectNoDependencyCalls(deps: ReturnType<typeof clearDependencies>): void {
  for (const dependency of Object.values(deps)) {
    expect(dependency).not.toHaveBeenCalled();
  }
}

const originalHome = process.env.OVERDECK_HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'overdeck-agent-restart-gate-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('agentRestartBlockReason', () => {
  it.each([undefined, '', '   '])(
    'allows a restart without an initiator (%s) without consulting deploy gates',
    async (initiator) => {
      const deps = clearDependencies();

      await expect(agentRestartBlockReason({ initiator, force: false }, deps)).resolves.toBeNull();
      expectNoDependencyCalls(deps);
      expect(await readPendingDeploy()).toBeNull();
    },
  );

  it('allows a forced agent restart without consulting deploy gates', async () => {
    const deps = clearDependencies();

    await expect(agentRestartBlockReason({ initiator: 'agent-pan-2772', force: true }, deps)).resolves.toBeNull();
    expectNoDependencyCalls(deps);
    expect(await readPendingDeploy()).toBeNull();
  });

  it('queues a refused restart and explains its age', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const deps = clearDependencies();
    deps.isMergeAgentRunning.mockResolvedValue(true);

    const result = await agentRestartBlockReason({ initiator: 'agent-pan-2772', force: false }, deps);
    const queued = await readPendingDeploy();

    expect(queued).toEqual({
      requestedAt: '2026-07-26T12:00:00.000Z',
      requestedBy: ['agent-pan-2772'],
      lastReason: 'Deployment deferred because a merge specialist session is active.',
      blockedBy: [],
      deferralCount: 1,
      escalated: false,
    });
    expect(result).toContain('queued since 2026-07-26T12:00:00.000Z (0s ago)');
    expect(result).toContain('fires automatically as soon as the window clears');
    expect(result).toContain('do not retry or use --force');
  });

  it('refreshes a queued restart without resetting its original request time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const deps = clearDependencies();
    deps.isMergeAgentRunning.mockResolvedValue(true);
    await agentRestartBlockReason({ initiator: 'agent-a', force: false }, deps);

    vi.setSystemTime(new Date('2026-07-26T12:05:00.000Z'));
    const result = await agentRestartBlockReason({ initiator: 'agent-z', force: false }, deps);

    expect(await readPendingDeploy()).toMatchObject({
      requestedAt: '2026-07-26T12:00:00.000Z',
      requestedBy: ['agent-a', 'agent-z'],
      blockedBy: [],
      deferralCount: 2,
    });
    expect(result).toContain('(5m ago)');
  });

  it('does not queue anything when the window is clear', async () => {
    const deps = clearDependencies();

    await expect(agentRestartBlockReason({
      initiator: 'flywheel-orchestrator',
      force: false,
    }, deps)).resolves.toBeNull();
    expect(await readPendingDeploy()).toBeNull();
  });
});
