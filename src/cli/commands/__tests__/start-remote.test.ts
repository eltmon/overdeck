/**
 * PAN-4734 WI-9: `pan start --remote` refuses the durable tier, a legacy
 * remote workspace and an unpushed branch before any dashboard request, then
 * posts the work door and prints the conversation URL. Every dependency is
 * injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ora } from 'ora';

import { NOT_RUNNING } from '../machines-call.js';
import { type StartRemoteDeps, startRemoteWorkAgent } from '../start-remote.js';

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const PROJECT = '/home/me/Projects/overdeck';

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

function harness(overrides: Partial<StartRemoteDeps> = {}) {
  const spinner = { text: '', fail: vi.fn(), succeed: vi.fn(), info: vi.fn() };
  const lines: string[] = [];
  const deps = {
    loadConfig: vi.fn(() => ({ remote: {} })),
    findLegacyWorkspace: vi.fn((): { vmName: string } | null => null),
    hasLocalWorktree: vi.fn(() => true),
    pushBranch: vi.fn(async () => ({ pushed: true })),
    branchOnOrigin: vi.fn(async () => true),
    dashboardBase: () => 'http://localhost:3011',
    post: vi.fn(async () => ({
      status: 201,
      json: { issueId: 'PAN-1', agentId: 'agent-pan-1', environmentId: ENV, name: '20261102-1234', path: `/conv/@${ENV}/20261102-1234`, machine: 'fly-m1' },
    })),
    markInProgress: vi.fn(async () => undefined),
    exit: vi.fn(async (code: number): Promise<never> => { throw new Exit(code); }),
    log: (line: string) => { lines.push(line); },
    ...overrides,
  } satisfies StartRemoteDeps;
  const run = (options: Parameters<typeof startRemoteWorkAgent>[1] = { model: '' }) =>
    startRemoteWorkAgent('PAN-1', options, spinner as unknown as Ora, { projectRoot: PROJECT }, deps);
  return { deps, spinner, lines, run };
}

beforeEach(() => {
  vi.stubEnv('OVERDECK_AUTO_SPAWN_CONSENT_REQUIRED', '');
  vi.stubEnv('OVERDECK_AGENT_STARTED_BY', '');
  vi.stubEnv('OVERDECK_CONVERSATION', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startRemoteWorkAgent (PAN-4734 WI-9)', () => {
  it('refuses --tier durable, and a durable config default, without a dashboard request', async () => {
    const flag = harness();
    await expect(flag.run({ model: '', tier: 'durable' })).rejects.toMatchObject({ code: 1 });
    expect(flag.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('the durable tier is not supported (PAN-4734)'));

    const config = harness({ loadConfig: vi.fn(() => ({ remote: { resiliency_tier: 'durable' as const } })) });
    await expect(config.run()).rejects.toMatchObject({ code: 1 });

    for (const { deps } of [flag, config]) expect(deps.post).not.toHaveBeenCalled();
  });

  it('refuses an issue with a legacy remote workspace without a dashboard request', async () => {
    const { deps, spinner, run } = harness({ findLegacyWorkspace: vi.fn(() => ({ vmName: 'ws-pan-1' })) });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    expect(spinner.fail).toHaveBeenCalledWith('PAN-1 has a legacy remote workspace (ws-pan-1). Destroy it first with pan workspace destroy PAN-1, then run pan start --remote again.');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('pushes the local worktree, then refuses when the branch is still not on origin', async () => {
    const { deps, spinner, run } = harness({ branchOnOrigin: vi.fn(async () => false) });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    expect(deps.pushBranch).toHaveBeenCalledWith(`${PROJECT}/workspaces/feature-pan-1`, 'feature/pan-1');
    expect(deps.branchOnOrigin).toHaveBeenCalledWith(PROJECT, 'feature/pan-1');
    expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('feature/pan-1 is not on origin'));
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('refuses when the push fails', async () => {
    const { deps, run } = harness({ pushBranch: vi.fn(async () => ({ pushed: false, reason: 'HEAD is detached' })) });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('posts the work door and prints the conversation URL on a 201', async () => {
    const { deps, spinner, run } = harness();
    await run({ model: 'claude-opus-5-5', effort: 'high', shadow: false });

    expect(deps.post).toHaveBeenCalledWith('http://localhost:3011', '/api/remote/work-agents', {
      issueId: 'PAN-1', model: 'claude-opus-5-5', effort: 'high', startedBy: 'operator:cli:pan-start', autoSpawnConsentRequired: false,
    });
    expect(spinner.succeed).toHaveBeenCalledWith(`Work agent for PAN-1 runs on fly-m1. Open: http://localhost:3011/conv/@${ENV}/20261102-1234`);
    expect(deps.markInProgress).toHaveBeenCalledWith('PAN-1', false);
  });

  it('prints the refusal message and exits 1 on a 409', async () => {
    const { deps, spinner, run } = harness({
      post: vi.fn(async () => ({ status: 409, json: { error: 'already-running', message: 'A work agent for PAN-1 is already running.' } })),
    });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    expect(spinner.fail).toHaveBeenCalledWith('Could not start the remote work agent for PAN-1: A work agent for PAN-1 is already running.');
    expect(deps.markInProgress).not.toHaveBeenCalled();
  });

  it('prints the dashboard-not-running sentence when the dashboard is unreachable', async () => {
    const { spinner, run } = harness({ post: vi.fn(async () => ({ unreachable: 'ECONNREFUSED' })) });
    await expect(run()).rejects.toMatchObject({ code: 1 });
    expect(spinner.fail).toHaveBeenCalledWith(NOT_RUNNING);
  });

  it('stops before the request on a dry run', async () => {
    const { deps, run } = harness();
    await run({ model: '', dryRun: true });
    expect(deps.post).not.toHaveBeenCalled();
  });
});
