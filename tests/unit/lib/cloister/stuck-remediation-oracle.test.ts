/**
 * The flywheel role is not exempt from the liveness contract (PAN-3849
 * findings round): `isFlywheelOrchestratorDead` used sessionExistsSync +
 * pane_dead, so a live session with an exited harness (runtime-missing) read
 * as alive and was never remediated. Both the in-place check and the
 * active-run-without-agent reconcile now consult the shared oracle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListRunningAgentsSync = vi.fn();
const mockIsAliveSync = vi.fn();
const mockResumeFlywheel = vi.fn();
const mockPauseFlywheel = vi.fn();

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: () => null,
  listRunningAgentsSync: (...args: unknown[]) => mockListRunningAgentsSync(...args),
  markAgentTroubled: vi.fn(),
  messageAgent: vi.fn(async () => undefined),
  resumeAgent: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/lib/agent-enrichment.js', () => ({
  countPendingAskUserQuestionsForAgent: () => 0,
}));
vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logDeaconEventSync: vi.fn(),
}));
vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: () => null,
}));
vi.mock('../../../../src/lib/tmux.js', () => ({
  capturePaneSync: () => '',
  detectTerminalApiErrorSync: () => null,
  // The session EXISTS and the pane is alive — only the harness is gone.
  sessionExistsSync: () => true,
  killSession: vi.fn(async () => undefined),
  killSessionSync: vi.fn(),
  listPaneValuesSync: () => ['0'],
  sendEscapeKeyAsync: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: () => ({ stuck_remediation: { enabled: true } }),
  DEFAULT_CLOISTER_CONFIG: { stuck_remediation: { enabled: true } },
}));
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  getAgentEffectiveLastActivityMs: () => null,
  getAgentWorkActivityMs: () => null,
  isAliveSync: (...args: unknown[]) => mockIsAliveSync(...args),
  // Mirrors the real isConfirmedDead: only a confirmed absence is death.
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
  isIdle: () => false,
}));
vi.mock('../../../../src/lib/cloister/agent-death.js', () => ({
  describeAgentDeath: () => 'runtime-missing (test)',
}));
vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  getFlywheelActiveRunId: () => 'run-1',
  isFlywheelGloballyPaused: () => false,
}));
vi.mock('../../../../src/lib/cloister/stuck-remediation-state.js', () => ({
  clearStuckRemediationState: vi.fn(),
  readStuckRemediationState: () => null,
  writeStuckRemediationState: vi.fn(),
}));
vi.mock('../../../../src/lib/xbrief/io.js', () => ({
  readWorkspacePlanSync: () => null,
}));
vi.mock('../../../../src/lib/xbrief/dag.js', () => ({
  getDispatchableItems: () => [],
}));
vi.mock('../../../../src/lib/cloister/recovery-trip.js', () => ({
  recordRecoveryFailure: vi.fn(),
}));
vi.mock('../../../../src/lib/cloister/planning-wedge.js', () => ({
  readAgentBackgroundTaskWedgeEvidence: () => null,
}));
vi.mock('../../../../src/lib/cloister/flywheel.js', () => ({
  resumeFlywheel: (...args: unknown[]) => mockResumeFlywheel(...args),
  pauseFlywheel: (...args: unknown[]) => mockPauseFlywheel(...args),
}));

import { checkStuckAgentRemediation } from '../../../../src/lib/cloister/stuck-remediation.js';

function flywheelAgent() {
  return {
    id: 'flywheel-orchestrator',
    issueId: 'FLYWHEEL',
    role: 'flywheel',
    status: 'running',
    workspace: '/tmp/ws',
    startedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('flywheel orchestrator liveness goes through the oracle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResumeFlywheel.mockResolvedValue(undefined);
    // Session present, pane alive, harness gone: dead under the oracle, alive
    // under the old sessionExists + pane_dead checks.
    mockIsAliveSync.mockReturnValue({ alive: false, reason: 'runtime-missing' });
  });

  it('remediates a listed flywheel agent whose harness has exited', async () => {
    mockListRunningAgentsSync.mockReturnValue([flywheelAgent()]);

    const actions = await checkStuckAgentRemediation({ now: Date.now() });

    expect(actions.some((a) => a.includes('DIED'))).toBe(true);
    expect(mockResumeFlywheel).toHaveBeenCalled();
  });

  it('remediates an active run whose orchestrator row is gone but whose harness has exited', async () => {
    mockListRunningAgentsSync.mockReturnValue([]);

    const actions = await checkStuckAgentRemediation({ now: Date.now() });

    expect(actions.some((a) => a.includes('DIED'))).toBe(true);
    expect(mockResumeFlywheel).toHaveBeenCalled();
  });

  it('leaves a truly alive orchestrator alone', async () => {
    mockIsAliveSync.mockReturnValue({ alive: true, paneAlive: true });
    mockListRunningAgentsSync.mockReturnValue([flywheelAgent()]);

    const actions = await checkStuckAgentRemediation({ now: Date.now() });

    expect(actions).toHaveLength(0);
    expect(mockResumeFlywheel).not.toHaveBeenCalled();
  });

  it('does not remediate on an indeterminate probe (a broken ps/pgrep is not death)', async () => {
    mockIsAliveSync.mockReturnValue({ alive: false, reason: 'runtime-indeterminate' });
    mockListRunningAgentsSync.mockReturnValue([flywheelAgent()]);

    const actions = await checkStuckAgentRemediation({ now: Date.now() });

    expect(actions).toHaveLength(0);
    expect(mockResumeFlywheel).not.toHaveBeenCalled();
  });

  it('does not remediate an active run without an agent row on an indeterminate probe', async () => {
    mockIsAliveSync.mockReturnValue({ alive: false, reason: 'runtime-indeterminate' });
    mockListRunningAgentsSync.mockReturnValue([]);

    const actions = await checkStuckAgentRemediation({ now: Date.now() });

    expect(actions).toHaveLength(0);
    expect(mockResumeFlywheel).not.toHaveBeenCalled();
  });
});
