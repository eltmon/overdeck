import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  readPlatformConfigSync: vi.fn(),
  restartDashboard: vi.fn(),
  writeRestartStatus: vi.fn(),
  readDevSupervisorMarker: vi.fn(),
  devSupervisorRefusalLines: vi.fn(),
  agentRestartBlockReason: vi.fn(),
  releaseRestartLock: vi.fn(),
  waitForRestartApproval: vi.fn(),
  registerRestartGateRequest: vi.fn(),
  approveRestartGate: vi.fn(),
  claimRestartGate: vi.fn(),
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/platform-lifecycle.js', () => ({
  openDashboardLogStdio: vi.fn(),
  readPlatformConfigSync: mocks.readPlatformConfigSync,
  restartDashboard: mocks.restartDashboard,
  restartCliproxy: vi.fn(),
  restartTraefik: vi.fn(),
  startTraefik: vi.fn(),
  stopTraefik: vi.fn(),
  waitForDashboardHealth: vi.fn(),
  stopDashboard: vi.fn(),
  StageError: class StageError extends Error {
    failure: { stage: string; reason: string };
    constructor(failure: { stage: string; reason: string }) {
      super(`[${failure.stage}] ${failure.reason}`);
      this.failure = failure;
    }
  },
}));

vi.mock('../../../lib/restart-status.js', () => ({
  writeRestartStatus: mocks.writeRestartStatus,
}));

vi.mock('../../../lib/dev-supervisor.js', () => ({
  readDevSupervisorMarker: mocks.readDevSupervisorMarker,
  devSupervisorRefusalLines: mocks.devSupervisorRefusalLines,
}));

vi.mock('../../../lib/deploy/agent-restart-gate.js', () => ({
  agentRestartBlockReason: mocks.agentRestartBlockReason,
}));

// The restart-approval gate (PAN-3729) talks HTTP to the dashboard. Mock it so
// these tests never reach the network and never wait on a real poll interval.
vi.mock('../../../lib/restart-gate-client.js', () => ({
  RESTART_GATE_CLAIMED_ENV: 'OVERDECK_RESTART_GATE_CLAIMED',
  restartGateRequesterId: (kind: string) => `${kind}:1234`,
  waitForRestartApproval: mocks.waitForRestartApproval,
  registerRestartGateRequest: mocks.registerRestartGateRequest,
  approveRestartGate: mocks.approveRestartGate,
  claimRestartGate: mocks.claimRestartGate,
}));

import { restartCommand } from '../restart.js';

const originalAgentId = process.env.OVERDECK_AGENT_ID;
const originalRestartInitiator = process.env.OVERDECK_RESTART_INITIATOR;
const originalLockHeld = process.env.OVERDECK_RESTART_LOCK_HELD;
const originalSkipSupervisorCycle = process.env.OVERDECK_SKIP_SUPERVISOR_CYCLE;
const originalGateClaimed = process.env.OVERDECK_RESTART_GATE_CLAIMED;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('restartCommand agent deploy-window gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    delete process.env.OVERDECK_AGENT_ID;
    delete process.env.OVERDECK_RESTART_INITIATOR;
    delete process.env.OVERDECK_RESTART_LOCK_HELD;
    delete process.env.OVERDECK_RESTART_GATE_CLAIMED;
    process.env.OVERDECK_SKIP_SUPERVISOR_CYCLE = '1';

    vi.spyOn(process, 'cwd').mockReturnValue('/repo');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    mocks.readPlatformConfigSync.mockReturnValue({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: '/tmp/traefik',
    });
    mocks.readDevSupervisorMarker.mockReturnValue(null);
    mocks.devSupervisorRefusalLines.mockReturnValue([]);
    mocks.agentRestartBlockReason.mockResolvedValue(null);
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed({
      refresh: vi.fn(async () => undefined),
      release: mocks.releaseRestartLock,
    }));
    mocks.restartDashboard.mockReturnValue(Effect.succeed(undefined));
    mocks.writeRestartStatus.mockReturnValue(Effect.succeed(undefined));
    mocks.releaseRestartLock.mockResolvedValue(undefined);
    mocks.waitForRestartApproval.mockResolvedValue({ proceed: true, reason: 'ungated', detail: 'no gate in tests' });
    mocks.registerRestartGateRequest.mockResolvedValue(null);
    mocks.approveRestartGate.mockResolvedValue(null);
    mocks.claimRestartGate.mockResolvedValue(null);
    mocks.readRestartLockHolder.mockReturnValue(Effect.succeed(null));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnv('OVERDECK_AGENT_ID', originalAgentId);
    restoreEnv('OVERDECK_RESTART_INITIATOR', originalRestartInitiator);
    restoreEnv('OVERDECK_RESTART_LOCK_HELD', originalLockHeld);
    restoreEnv('OVERDECK_SKIP_SUPERVISOR_CYCLE', originalSkipSupervisorCycle);
    restoreEnv('OVERDECK_RESTART_GATE_CLAIMED', originalGateClaimed);
    process.exitCode = undefined;
  });

  it('refuses a blocked agent restart before acquiring the restart lock', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';
    mocks.agentRestartBlockReason.mockResolvedValue('Restart refused by active deployment gate.');

    await restartCommand({ dashboard: true });

    expect(mocks.agentRestartBlockReason).toHaveBeenCalledWith({
      initiator: 'agent-pan-2772',
      force: false,
    });
    expect(console.error).toHaveBeenCalledWith('Restart refused by active deployment gate.');
    expect(process.exitCode).toBe(1);
    expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
  });

  it('allows --force to proceed through the gate and acquire the restart lock', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';

    await restartCommand({ dashboard: true, force: true });

    expect(mocks.agentRestartBlockReason).toHaveBeenCalledWith({
      initiator: 'agent-pan-2772',
      force: true,
    });
    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan restart');
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRestartLock).toHaveBeenCalledTimes(1);
  });

  it('skips the gate and lock acquisition for an inner restart invocation', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';
    process.env.OVERDECK_RESTART_LOCK_HELD = '1';

    await restartCommand({ dashboard: true });

    expect(mocks.agentRestartBlockReason).not.toHaveBeenCalled();
    expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
  });

  it('skips the gate for a restart without an agent initiator', async () => {
    await restartCommand({ dashboard: true });

    expect(mocks.agentRestartBlockReason).not.toHaveBeenCalled();
    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan restart');
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
  });

  it('persists the watchdog initiator and stopping phase before restarting', async () => {
    process.env.OVERDECK_RESTART_LOCK_HELD = '1';
    process.env.OVERDECK_RESTART_INITIATOR = 'supervisor-watchdog';

    await restartCommand({ dashboard: true });

    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'pan restart',
      success: false,
      phase: 'stopping',
      initiator: 'supervisor-watchdog',
    }));
    expect(mocks.writeRestartStatus.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.restartDashboard.mock.invocationCallOrder[0]);
  });

  it('warns that a proceeding agent restart disconnects live sessions', async () => {
    process.env.OVERDECK_AGENT_ID = 'agent-pan-2772';

    await restartCommand({ dashboard: true });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(
      'disconnect every live conversation and terminal until clients reconnect',
    ));
  });

  describe('restart-approval gate (PAN-3729)', () => {
    it('waits for operator approval before taking the restart lock', async () => {
      await restartCommand({ dashboard: true });

      expect(mocks.waitForRestartApproval).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'restart',
        requesterId: 'restart:1234',
      }));
      expect(mocks.waitForRestartApproval.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.acquireRestartLock.mock.invocationCallOrder[0]);
      expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    });

    it('restarts nothing when another approved requester already restarted the dashboard', async () => {
      mocks.waitForRestartApproval.mockResolvedValue({
        proceed: false,
        reason: 'satisfied',
        detail: 'another approved requester already restarted the dashboard',
      });

      await restartCommand({ dashboard: true });

      expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
      expect(mocks.restartDashboard).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('skips the gate when the spawning requester already cleared it', async () => {
      process.env.OVERDECK_RESTART_GATE_CLAIMED = '1';

      await restartCommand({ dashboard: true });

      expect(mocks.waitForRestartApproval).not.toHaveBeenCalled();
      expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    });

    it('never gates the supervisor watchdog — that restart is involuntary recovery', async () => {
      process.env.OVERDECK_RESTART_LOCK_HELD = '1';
      process.env.OVERDECK_RESTART_INITIATOR = 'supervisor-watchdog';

      await restartCommand({ dashboard: true });

      expect(mocks.waitForRestartApproval).not.toHaveBeenCalled();
      expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    });

    it('--now approves and claims instead of waiting, so blocked requesters are satisfied by its restart', async () => {
      mocks.approveRestartGate.mockResolvedValue({ approved: true, pendingCount: 1 });
      mocks.claimRestartGate.mockResolvedValue(true);

      await restartCommand({ dashboard: true, now: true });

      expect(mocks.waitForRestartApproval).not.toHaveBeenCalled();
      expect(mocks.registerRestartGateRequest).toHaveBeenCalledTimes(1);
      expect(mocks.approveRestartGate).toHaveBeenCalledTimes(1);
      expect(mocks.claimRestartGate).toHaveBeenCalledWith('restart:1234');
      expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    });

    it('--now approves and steps aside when another process already holds the restart lock', async () => {
      mocks.readRestartLockHolder.mockReturnValue(Effect.succeed({
        pid: 4242,
        ts: Date.now(),
        caller: 'pan reload',
      }));
      mocks.approveRestartGate.mockResolvedValue({ approved: true, pendingCount: 2 });

      await restartCommand({ dashboard: true, now: true });

      expect(mocks.approveRestartGate).toHaveBeenCalledTimes(1);
      expect(mocks.claimRestartGate).not.toHaveBeenCalled();
      expect(mocks.acquireRestartLock).not.toHaveBeenCalled();
      expect(mocks.restartDashboard).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('PID 4242 (pan reload)'));
      expect(process.exitCode).toBeUndefined();
    });
  });
});
