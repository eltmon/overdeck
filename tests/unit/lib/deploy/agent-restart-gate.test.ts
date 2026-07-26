import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRestartBlockReason } from '../../../../src/lib/deploy/agent-restart-gate.js';
import { readPendingDeploy } from '../../../../src/lib/deploy/deploy-queue.js';
import type { DeployWindowDependencies } from '../../../../src/lib/deploy/deploy-window.js';

function clearDependencies() {
  return {
    loadReviewStatuses: vi.fn(() => ({})),
    getFlywheelActiveRunId: vi.fn(() => null as string | null),
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

  it('queues a refused restart and explains its age and distinct verification blockers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const deps = clearDependencies();
    deps.loadReviewStatuses.mockReturnValue({
      'PAN-20': { issueId: 'PAN-20', verificationStatus: 'running' },
      'PAN-10': { issueId: 'PAN-10', verificationStatus: 'running' },
    });

    const result = await agentRestartBlockReason({ initiator: 'agent-pan-2772', force: false }, deps);
    const queued = await readPendingDeploy();

    expect(queued).toEqual({
      requestedAt: '2026-07-26T12:00:00.000Z',
      requestedBy: ['agent-pan-2772'],
      lastReason: 'Deployment deferred because verification is in flight for PAN-10, PAN-20.',
      blockedBy: ['PAN-10', 'PAN-20'],
      deferralCount: 1,
      escalated: false,
    });
    expect(result).toContain('queued since 2026-07-26T12:00:00.000Z (0s ago)');
    expect(result).toContain('2 distinct verifications: PAN-10, PAN-20');
    expect(result).toContain('fire automatically at the next verification boundary');
    expect(result).toContain('do not retry or use --force');
  });

  it('refreshes a queued restart without resetting its original request time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const deps = clearDependencies();
    deps.loadReviewStatuses.mockReturnValue({
      'PAN-10': { issueId: 'PAN-10', verificationStatus: 'running' },
    });
    await agentRestartBlockReason({ initiator: 'agent-a', force: false }, deps);

    vi.setSystemTime(new Date('2026-07-26T12:05:00.000Z'));
    deps.loadReviewStatuses.mockReturnValue({
      'PAN-20': { issueId: 'PAN-20', verificationStatus: 'running' },
    });
    const result = await agentRestartBlockReason({ initiator: 'agent-z', force: false }, deps);

    expect(await readPendingDeploy()).toMatchObject({
      requestedAt: '2026-07-26T12:00:00.000Z',
      requestedBy: ['agent-a', 'agent-z'],
      blockedBy: ['PAN-10', 'PAN-20'],
      deferralCount: 2,
    });
    expect(result).toContain('(5m ago)');
    expect(result).toContain('2 distinct verifications: PAN-10, PAN-20');
  });

  it('does not block the flywheel on its own active run', async () => {
    const deps = clearDependencies();
    deps.getFlywheelActiveRunId.mockReturnValue('RUN-42');

    await expect(agentRestartBlockReason({
      initiator: 'flywheel-orchestrator',
      force: false,
    }, deps)).resolves.toBeNull();
    expect(deps.getFlywheelActiveRunId).not.toHaveBeenCalled();
    expect(await readPendingDeploy()).toBeNull();
  });

  it('still blocks the flywheel while verification is in flight', async () => {
    const deps = clearDependencies();
    deps.loadReviewStatuses.mockReturnValue({
      'PAN-100': { issueId: 'PAN-100', verificationStatus: 'running' },
    });
    deps.getFlywheelActiveRunId.mockReturnValue('RUN-42');

    const result = await agentRestartBlockReason({
      initiator: 'flywheel-orchestrator',
      force: false,
    }, deps);

    expect(result).toContain('"Deployment deferred because verification is in flight for PAN-100."');
    expect(result).toContain('1 distinct verification: PAN-100');
    expect(result).toContain('do not retry or use --force');
    expect((await readPendingDeploy())?.requestedBy).toEqual(['flywheel-orchestrator']);
    expect(deps.getFlywheelActiveRunId).not.toHaveBeenCalled();
  });
});
