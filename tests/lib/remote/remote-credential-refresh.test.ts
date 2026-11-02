import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshClaudeCredentialsForActiveRemoteAgents,
  resetRemoteClaudeCredentialRefreshForTests,
} from '../../../src/lib/remote/remote-credential-refresh.js';

const activeRemoteState = (issueId: string, vmName: string) => ({
  id: `agent-${issueId.toLowerCase()}`,
  issueId,
  vmName,
  model: 'claude-fable-5',
  status: 'running' as const,
  startedAt: '2026-06-11T00:00:00.000Z',
  location: 'remote' as const,
});

describe('remote Claude credential proactive refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
    resetRemoteClaudeCredentialRefreshForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not construct a Fly provider when no remote agents are active', async () => {
    const syncClaudeCredentials = vi.fn();
    const loadConfig = vi.fn(() => ({ remote: { provider: 'fly' } }));
    const createFlyProvider = vi.fn(() => ({ syncClaudeCredentials }));
    const credentialFingerprint = vi.fn(() => '100:12');

    const actions = await refreshClaudeCredentialsForActiveRemoteAgents({
      listActiveRemoteAgentStates: () => [],
      credentialFingerprint,
      loadConfig,
      createFlyProvider: createFlyProvider as any,
    });

    expect(actions).toEqual([]);
    expect(credentialFingerprint).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(createFlyProvider).not.toHaveBeenCalled();
    expect(syncClaudeCredentials).not.toHaveBeenCalled();
  });

  it('refreshes active remote agents immediately when host credentials change', async () => {
    const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
    const createFlyProvider = vi.fn(() => ({ syncClaudeCredentials }));
    let fingerprint = '100:12';

    const deps = {
      listActiveRemoteAgentStates: () => [activeRemoteState('PAN-1778', 'vm-one')],
      credentialFingerprint: () => fingerprint,
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: createFlyProvider as any,
    };

    await expect(refreshClaudeCredentialsForActiveRemoteAgents(deps)).resolves.toEqual([
      'Remote credentials refreshed for PAN-1778 on vm-one',
    ]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);
    expect(syncClaudeCredentials).toHaveBeenLastCalledWith('vm-one');

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(refreshClaudeCredentialsForActiveRemoteAgents(deps)).resolves.toEqual([]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    fingerprint = '200:12';
    await expect(refreshClaudeCredentialsForActiveRemoteAgents(deps)).resolves.toEqual([
      'Remote credentials refreshed for PAN-1778 on vm-one',
    ]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
  });

  it('falls back to a 15 minute cadence when no host credentials file fingerprint exists', async () => {
    const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
    const deps = {
      listActiveRemoteAgentStates: () => [activeRemoteState('PAN-1778', 'vm-one')],
      credentialFingerprint: () => null,
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
    };

    await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14 * 60_000);
    await expect(refreshClaudeCredentialsForActiveRemoteAgents(deps)).resolves.toEqual([]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(refreshClaudeCredentialsForActiveRemoteAgents(deps)).resolves.toEqual([
      'Remote credentials refreshed for PAN-1778 on vm-one',
    ]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
  });

  it('refreshes every active remote agent in one patrol action', async () => {
    const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
    const deps = {
      listActiveRemoteAgentStates: () => [
        activeRemoteState('PAN-1778', 'vm-one'),
        activeRemoteState('PAN-1762', 'vm-two'),
      ],
      credentialFingerprint: () => '100:12',
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
    };

    const actions = await refreshClaudeCredentialsForActiveRemoteAgents(deps);

    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
    expect(syncClaudeCredentials).toHaveBeenNthCalledWith(1, 'vm-one');
    expect(syncClaudeCredentials).toHaveBeenNthCalledWith(2, 'vm-two');
    expect(actions).toEqual([
      'Remote credentials refreshed for PAN-1778 on vm-one',
      'Remote credentials refreshed for PAN-1762 on vm-two',
    ]);
  });

  it('retries a failed VM on the next patrol without advancing its watermark', async () => {
    const syncClaudeCredentials = vi
      .fn()
      .mockRejectedValueOnce(new Error('fly API unreachable'))
      .mockResolvedValueOnce(true);
    const deps = {
      listActiveRemoteAgentStates: () => [activeRemoteState('PAN-1778', 'vm-one')],
      credentialFingerprint: () => '100:12',
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
    };

    const first = await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(first).toEqual([
      'Remote credentials refresh failed for PAN-1778 on vm-one: fly API unreachable',
    ]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    // Same fingerprint, well within 15 min — but prior failure left watermark
    // intact, so the VM retries immediately.
    const second = await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(second).toEqual(['Remote credentials refreshed for PAN-1778 on vm-one']);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);

    // Now the watermark is advanced; same fingerprint is a no-op.
    const third = await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(third).toEqual([]);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
  });

  it('does not let one VM success block a newly started VM with the same fingerprint', async () => {
    const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
    let activeStates = [activeRemoteState('PAN-1778', 'vm-one')];
    const deps = {
      listActiveRemoteAgentStates: () => activeStates,
      credentialFingerprint: () => '100:12',
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
    };

    await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    // A second VM starts before the host credentials change again.
    activeStates = [
      activeRemoteState('PAN-1778', 'vm-one'),
      activeRemoteState('PAN-1762', 'vm-two'),
    ];
    await vi.advanceTimersByTimeAsync(60_000);
    const actions = await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(actions).toEqual(['Remote credentials refreshed for PAN-1762 on vm-two']);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
    expect(syncClaudeCredentials).toHaveBeenLastCalledWith('vm-two');
  });

  it('drops watermark state for VMs that are no longer active', async () => {
    const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
    let activeStates = [activeRemoteState('PAN-1778', 'vm-one')];
    const deps = {
      listActiveRemoteAgentStates: () => activeStates,
      credentialFingerprint: () => '100:12',
      loadConfig: () => ({ remote: { provider: 'fly' } }),
      createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
    };

    await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);

    // vm-one goes away; a new machine with the same vmName appears later.
    // The stale watermark should be discarded so the new machine refreshes.
    activeStates = [];
    await refreshClaudeCredentialsForActiveRemoteAgents(deps);

    activeStates = [activeRemoteState('PAN-1778', 'vm-one')];
    await vi.advanceTimersByTimeAsync(60_000);
    const actions = await refreshClaudeCredentialsForActiveRemoteAgents(deps);
    expect(actions).toEqual(['Remote credentials refreshed for PAN-1778 on vm-one']);
    expect(syncClaudeCredentials).toHaveBeenCalledTimes(2);
  });

  describe('Fly machines (PAN-4652 FR-15)', () => {
    it('syncs a Fly machine by name with no remote agents, through an ephemeral provider', async () => {
      const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
      const createFlyProvider = vi.fn(() => ({ syncClaudeCredentials }));
      const remote = { provider: 'fly' };
      const actions = await refreshClaudeCredentialsForActiveRemoteAgents({
        listActiveRemoteAgentStates: () => [],
        listFlyMachineNames: async () => ['overdeck-machine-1a2b3c4d'],
        credentialFingerprint: () => '100:12',
        loadConfig: () => ({ remote }) as any,
        createFlyProvider: createFlyProvider as any,
      });

      expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);
      expect(syncClaudeCredentials).toHaveBeenCalledWith('overdeck-machine-1a2b3c4d');
      expect(createFlyProvider).toHaveBeenCalledWith(remote, 'ephemeral');
      expect(actions).toEqual(['Remote credentials refreshed for Fly machine on overdeck-machine-1a2b3c4d']);
    });

    it('re-syncs on a changed fingerprint and retries a failed sync on the next tick', async () => {
      const syncClaudeCredentials = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('exec 503')).mockResolvedValue(true);
      let fingerprint = '100:12';
      const deps = {
        listActiveRemoteAgentStates: () => [],
        listFlyMachineNames: async () => ['overdeck-machine-1a2b3c4d'],
        credentialFingerprint: () => fingerprint,
        loadConfig: () => ({ remote: { provider: 'fly' } }) as any,
        createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
      };

      await refreshClaudeCredentialsForActiveRemoteAgents(deps);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await refreshClaudeCredentialsForActiveRemoteAgents(deps)).toEqual([]);

      fingerprint = '200:12';
      expect((await refreshClaudeCredentialsForActiveRemoteAgents(deps))[0]).toMatch(/^Remote credentials refresh failed for Fly machine on overdeck-machine-1a2b3c4d: exec 503/);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await refreshClaudeCredentialsForActiveRemoteAgents(deps)).toEqual(['Remote credentials refreshed for Fly machine on overdeck-machine-1a2b3c4d']);
      expect(syncClaudeCredentials).toHaveBeenCalledTimes(3);
    });

    it('constructs no provider with zero agents and zero Fly machines', async () => {
      const createFlyProvider = vi.fn();
      const actions = await refreshClaudeCredentialsForActiveRemoteAgents({
        listActiveRemoteAgentStates: () => [],
        listFlyMachineNames: async () => [],
        createFlyProvider: createFlyProvider as any,
      });
      expect(actions).toEqual([]);
      expect(createFlyProvider).not.toHaveBeenCalled();
    });

    it('syncs a linked work agent\'s VM once, as its Fly machine (PAN-4734 FR-10)', async () => {
      const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
      const actions = await refreshClaudeCredentialsForActiveRemoteAgents({
        listActiveRemoteAgentStates: () => [{ ...activeRemoteState('PAN-4734', 'overdeck-machine-1a2b3c4d'), linked: true as const }],
        listFlyMachineNames: async () => ['overdeck-machine-1a2b3c4d'],
        credentialFingerprint: () => '100:12',
        loadConfig: () => ({ remote: { provider: 'fly' } }) as any,
        createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
      });
      expect(syncClaudeCredentials).toHaveBeenCalledTimes(1);
      expect(syncClaudeCredentials).toHaveBeenCalledWith('overdeck-machine-1a2b3c4d');
      expect(actions).toEqual(['Remote credentials refreshed for Fly machine on overdeck-machine-1a2b3c4d']);
    });

    it('still refreshes remote agents when the Fly machine store is unreadable', async () => {
      const syncClaudeCredentials = vi.fn().mockResolvedValue(true);
      const actions = await refreshClaudeCredentialsForActiveRemoteAgents({
        listActiveRemoteAgentStates: () => [activeRemoteState('PAN-1778', 'vm-one')],
        listFlyMachineNames: async () => { throw new Error('Fly machine store /x/fly-machines.json has an unexpected shape'); },
        credentialFingerprint: () => '100:12',
        loadConfig: () => ({ remote: { provider: 'fly' } }) as any,
        createFlyProvider: (() => ({ syncClaudeCredentials })) as any,
      });
      expect(actions[0]).toMatch(/^Fly machine credentials refresh skipped: .*unexpected shape/);
      expect(actions[1]).toBe('Remote credentials refreshed for PAN-1778 on vm-one');
    });
  });
});
