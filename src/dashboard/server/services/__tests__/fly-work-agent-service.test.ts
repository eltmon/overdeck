/**
 * PAN-4734 WI-7: startFlyWorkAgent provisions a Fly machine, adds the issue
 * worktree and starts the work agent as a linked conversation. Refusals create
 * no machine; a failure after provisioning unlinks once and saves `error`.
 */
import { describe, expect, it, vi } from 'vitest';

import { FlyMachineError } from '../../../../lib/anywhere/fly/provision.js';
import type { FlyMachineRecord } from '../../../../lib/anywhere/fly/machine-store.js';
import type { RemoteAgentState } from '../../../../lib/remote/remote-agents.js';
import { type FlyWorkAgentDeps, startFlyWorkAgent } from '../fly-work-agent-service.js';

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const WORKDIR = '/workspace/overdeck/workspaces/feature-pan-4734';
const NOW = new Date('2026-11-02T12:00:00.000Z');

const RECORD: FlyMachineRecord = {
  id: 'rec-1', linkId: 'link-1', environmentId: ENV, machineId: 'm1', machineName: 'overdeck-machine-1a2b3c4d',
  appName: 'overdeck-ws', region: 'iad', label: 'fly-m1', projectKey: 'overdeck', docker: true, codexAuthPath: null,
  createdAt: NOW.toISOString(),
};

function fakes(overrides: Partial<FlyWorkAgentDeps> = {}) {
  const calls: string[] = [];
  const saved: RemoteAgentState[] = [];
  const provider = { ssh: vi.fn(), copySkillsToVm: vi.fn(async () => { calls.push('copySkills'); }) };
  const deps = {
    notifyLinksChanged: vi.fn(),
    unlink: vi.fn(async () => ({ status: 200 })),
    loadConfig: async () => ({ remote: { enabled: true } }),
    resolveProject: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/home/me/Projects/overdeck' })),
    determineModel: vi.fn((model: string | undefined) => model ?? 'claude-opus-5-5'),
    resolveEffort: vi.fn(() => ({ effort: 'high' })),
    providerName: vi.fn(() => 'anthropic'),
    addFlyMachine: vi.fn(async () => { calls.push('addFlyMachine'); return { link: {} as never, record: RECORD }; }),
    ensureWorkspace: vi.fn(async () => { calls.push('ensureWorkspace'); return WORKDIR; }),
    startConversation: vi.fn(async () => {
      calls.push('startConversation');
      return { environmentId: ENV, name: '20261102-1234', path: `/conv/@${ENV}/20261102-1234`, tmuxSession: 'conv-20261102-1234' };
    }),
    createProvider: vi.fn(() => provider),
    writeRemoteFile: vi.fn(async (_p: unknown, _vm: string, path: string) => { calls.push(`write ${path}`); }),
    installPushDaemon: vi.fn(async () => { calls.push('installPushDaemon'); }),
    loadState: vi.fn((): RemoteAgentState | null => null),
    saveState: vi.fn((state: RemoteAgentState) => { saved.push({ ...state }); }),
    buildPrompt: vi.fn(async () => 'You are the work agent for PAN-4734.'),
    readHomeFile: vi.fn((): string | null => null),
    withConsent: vi.fn(),
    refreshLinked: vi.fn(async () => { calls.push('refreshLinked'); }),
    now: () => NOW,
    log: vi.fn(),
    ...overrides,
  } satisfies FlyWorkAgentDeps;
  return { deps, calls, saved, provider };
}

const operatorInput = { issueId: 'pan-4734', startedBy: 'operator:cli:pan-start' };

describe('startFlyWorkAgent (PAN-4734 WI-7)', () => {
  it('provisions, adds the worktree, starts the conversation and saves every linked field as running', async () => {
    const { deps, calls, saved } = fakes({ readHomeFile: vi.fn(() => '{"decisions":[]}') });

    const result = await startFlyWorkAgent(operatorInput, deps);

    expect(result).toEqual({
      issueId: 'PAN-4734', agentId: 'agent-pan-4734', environmentId: ENV, name: '20261102-1234',
      path: `/conv/@${ENV}/20261102-1234`, machine: 'fly-m1',
    });
    expect(calls).toEqual([
      'addFlyMachine', 'ensureWorkspace', `write ${WORKDIR}/.overdeck/continue.json`, 'copySkills',
      'startConversation', 'installPushDaemon', 'refreshLinked',
    ]);
    expect(deps.addFlyMachine).toHaveBeenCalledWith({ projectKey: 'overdeck', harness: 'claude-code' }, { notifyLinksChanged: deps.notifyLinksChanged });
    expect(deps.readHomeFile).toHaveBeenCalledWith('/home/me/Projects/overdeck/workspaces/feature-pan-4734/.overdeck/continue.json');
    expect(deps.installPushDaemon).toHaveBeenCalledWith(expect.anything(), 'overdeck-machine-1a2b3c4d', 'PAN-4734', WORKDIR);
    expect(deps.refreshLinked).toHaveBeenCalledWith('link-1');

    expect(saved[0]).toMatchObject({ id: 'agent-pan-4734', vmName: '', status: 'starting', linked: true, tmuxSocket: 'overdeck', projectKey: 'overdeck' });
    expect(saved.at(-1)).toEqual({
      id: 'agent-pan-4734', issueId: 'PAN-4734', vmName: 'overdeck-machine-1a2b3c4d', model: 'claude-opus-5-5',
      status: 'running', startedAt: NOW.toISOString(), location: 'remote', startedBy: 'operator:cli:pan-start', tier: 'ephemeral',
      linked: true, environmentId: ENV, linkId: 'link-1', flyMachineId: 'm1', conversationName: '20261102-1234',
      tmuxSession: 'conv-20261102-1234', tmuxSocket: 'overdeck', projectKey: 'overdeck', workdir: WORKDIR,
    });
  });

  it('starts the conversation in the worktree, under the issue, with Claude Code and the rendered prompt', async () => {
    const { deps } = fakes();
    await startFlyWorkAgent({ ...operatorInput, model: 'claude-sonnet-5-5', effort: 'medium' }, deps);

    expect(deps.buildPrompt).toHaveBeenCalledWith('PAN-4734', WORKDIR);
    expect(deps.startConversation).toHaveBeenCalledWith({ environmentId: ENV }, {
      message: 'You are the work agent for PAN-4734.', projectKey: 'overdeck', cwd: WORKDIR, issueId: 'PAN-4734',
      harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high',
    });
    expect(deps.resolveEffort).toHaveBeenCalledWith({ explicit: 'medium', issueId: 'PAN-4734', model: 'claude-sonnet-5-5' });
  });

  it('writes a prompt over 50,000 characters to a file and sends a pointer', async () => {
    const { deps, calls } = fakes({ buildPrompt: vi.fn(async () => 'x'.repeat(50_001)) });
    await startFlyWorkAgent(operatorInput, deps);

    expect(calls).toContain('write /workspace/.pan/prompts/agent-pan-4734.md');
    expect(deps.startConversation).toHaveBeenCalledWith({ environmentId: ENV }, expect.objectContaining({
      message: 'Read /workspace/.pan/prompts/agent-pan-4734.md and follow it exactly. It is your work-agent prompt for PAN-4734.',
    }));
  });

  it('refuses an unknown project, a non-Anthropic model and a running agent without provisioning', async () => {
    const unknown = fakes({ resolveProject: vi.fn(() => null) });
    await expect(startFlyWorkAgent(operatorInput, unknown.deps)).rejects.toMatchObject({ code: 'project-unknown', status: 404 });

    const openai = fakes({ providerName: vi.fn(() => 'openai') });
    await expect(startFlyWorkAgent({ ...operatorInput, model: 'gpt-5.5' }, openai.deps)).rejects.toMatchObject({ code: 'harness-unsupported', status: 400 });

    const running = fakes({ loadState: vi.fn(() => ({
      id: 'agent-pan-4734', issueId: 'PAN-4734', vmName: 'overdeck-machine-1a2b3c4d', model: 'm', status: 'running' as const,
      startedAt: NOW.toISOString(), location: 'remote' as const, startedBy: 'operator', environmentId: ENV, conversationName: '20261102-1234',
    })) });
    await expect(startFlyWorkAgent(operatorInput, running.deps)).rejects.toMatchObject({
      code: 'already-running', status: 409, message: expect.stringContaining(`/conv/@${ENV}/20261102-1234`),
    });

    for (const { deps, saved } of [unknown, openai, running]) {
      expect(deps.addFlyMachine).not.toHaveBeenCalled();
      expect(saved).toEqual([]);
    }
  });

  it('overwrites a starting state 31 minutes old and refuses one 5 minutes old', async () => {
    const starting = (minutesAgo: number) => (): RemoteAgentState => ({
      id: 'agent-pan-4734', issueId: 'PAN-4734', vmName: '', model: 'm', status: 'starting',
      startedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), location: 'remote', startedBy: 'operator',
    });

    const stale = fakes({ loadState: vi.fn(starting(31)) });
    await expect(startFlyWorkAgent(operatorInput, stale.deps)).resolves.toMatchObject({ name: '20261102-1234' });

    const fresh = fakes({ loadState: vi.fn(starting(5)) });
    await expect(startFlyWorkAgent(operatorInput, fresh.deps)).rejects.toMatchObject({ code: 'already-running' });
    expect(fresh.deps.addFlyMachine).not.toHaveBeenCalled();
  });

  it('unlinks once and saves error when the worktree fails after provisioning', async () => {
    const { deps, saved } = fakes({
      ensureWorkspace: vi.fn(async () => { throw new FlyMachineError('workspace-failed', 'fatal: no such ref'); }),
    });

    await expect(startFlyWorkAgent(operatorInput, deps)).rejects.toMatchObject({ code: 'workspace-failed' });
    expect(deps.unlink).toHaveBeenCalledTimes(1);
    expect(deps.unlink).toHaveBeenCalledWith('link-1');
    expect(saved.at(-1)).toMatchObject({ status: 'error', vmName: 'overdeck-machine-1a2b3c4d', flyMachineId: 'm1' });
    expect(deps.startConversation).not.toHaveBeenCalled();
  });

  it('keeps the original error when the unlink fails', async () => {
    const { deps } = fakes({
      startConversation: vi.fn(async () => { throw new FlyMachineError('conversation-failed', 'refused'); }),
      unlink: vi.fn(async () => ({ status: 500 })),
    });

    await expect(startFlyWorkAgent(operatorInput, deps)).rejects.toMatchObject({ code: 'conversation-failed' });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('status 500'));
  });

  it('saves error without unlinking when provisioning itself fails', async () => {
    const { deps, saved } = fakes({
      addFlyMachine: vi.fn(async () => { throw new FlyMachineError('cap-reached', 'cap'); }),
    });

    await expect(startFlyWorkAgent(operatorInput, deps)).rejects.toMatchObject({ code: 'cap-reached' });
    expect(deps.unlink).not.toHaveBeenCalled();
    expect(saved.at(-1)).toMatchObject({ status: 'error', vmName: '' });
  });

  it('runs a non-operator start inside the consent claim and accepts only after the conversation started', async () => {
    const order: string[] = [];
    const accept = vi.fn(async () => { order.push('accept'); });
    const withConsent = vi.fn(async (_issueId: string, operation: (accept: () => Promise<void>, claim: { issueId: string; generation: string; claimId: string; workModel?: string }) => Promise<RemoteAgentState>) =>
      operation(accept, { issueId: 'PAN-4734', generation: 'g1', claimId: 'c1', workModel: 'claude-sonnet-5-5' }));
    const { deps } = fakes({
      withConsent: withConsent as unknown as FlyWorkAgentDeps['withConsent'],
      startConversation: vi.fn(async () => {
        order.push('startConversation');
        return { environmentId: ENV, name: '20261102-1234', path: '', tmuxSession: 'conv-20261102-1234' };
      }),
    });

    await startFlyWorkAgent({ issueId: 'PAN-4734', startedBy: 'flywheel', autoSpawnConsentRequired: true }, deps);

    expect(withConsent).toHaveBeenCalledWith('PAN-4734', expect.any(Function), { isAccepted: expect.any(Function) });
    expect(order).toEqual(['startConversation', 'accept']);
    expect(deps.determineModel).toHaveBeenCalledWith('claude-sonnet-5-5');
  });

  it('does not claim consent for an operator start', async () => {
    const { deps } = fakes();
    await startFlyWorkAgent({ ...operatorInput, autoSpawnConsentRequired: true }, deps);
    expect(deps.withConsent).not.toHaveBeenCalled();
  });
});
