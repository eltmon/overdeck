import { describe, expect, it, vi } from 'vitest';

import { agentRestartBlockReason } from '../../../../src/lib/deploy/agent-restart-gate.js';
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

describe('agentRestartBlockReason', () => {
  it.each([undefined, '', '   '])(
    'allows a restart without an initiator (%s) without consulting deploy gates',
    async (initiator) => {
      const deps = clearDependencies();

      await expect(agentRestartBlockReason({ initiator, force: false }, deps)).resolves.toBeNull();
      expectNoDependencyCalls(deps);
    },
  );

  it('allows a forced agent restart without consulting deploy gates', async () => {
    const deps = clearDependencies();

    await expect(agentRestartBlockReason({ initiator: 'agent-pan-2772', force: true }, deps)).resolves.toBeNull();
    expectNoDependencyCalls(deps);
  });

  it('refuses an agent restart with the active reason and force bypass explained', async () => {
    const deps = clearDependencies();
    deps.getFlywheelActiveRunId.mockReturnValue('RUN-42');

    const result = await agentRestartBlockReason({ initiator: 'agent-pan-2772', force: false }, deps);

    expect(result).toContain('"Deployment deferred because flywheel run RUN-42 owns deployment."');
    expect(result).toContain('This agent-issued restart would disconnect live sessions while that gate is active.');
    expect(result).toContain('Rerun with --force to bypass the gate.');
  });

  it('does not block the flywheel on its own active run', async () => {
    const deps = clearDependencies();
    deps.getFlywheelActiveRunId.mockReturnValue('RUN-42');

    await expect(agentRestartBlockReason({
      initiator: 'flywheel-orchestrator',
      force: false,
    }, deps)).resolves.toBeNull();
    expect(deps.getFlywheelActiveRunId).not.toHaveBeenCalled();
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
    expect(result).toContain('Rerun with --force to bypass the gate.');
    expect(deps.getFlywheelActiveRunId).not.toHaveBeenCalled();
  });
});
