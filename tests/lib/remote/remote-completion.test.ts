import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshClaudeCredentialsForActiveRemoteAgents,
  resetRemoteClaudeCredentialRefreshForTests,
} from '../../../src/lib/remote/remote-completion.js';

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
});
