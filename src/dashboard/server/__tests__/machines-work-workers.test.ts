/**
 * PAN-4651 WI-5 (D-4651-3): the worker work door starts a worker in the
 * project the issue resolves to, after the origin check, and records the
 * caller's machine in worker.json; an agent actor stops only what its own
 * machine started.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { AgentState } from '../../../lib/agents/agent-state-read.js';
import { workerDir, workerFactsPath } from '../../../lib/agents/worker/ids.js';
import { startWorker, type StartWorkerOptions } from '../../../lib/agents/worker/start.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { handleWorkWorker, readJsonResponse, type WorkerDoorDeps } from '../routes/machines-work.js';
import { handleWorkerStop, type WorkerFollowDeps } from '../routes/workers.js';
import { readWorkerFacts } from '../../../lib/agents/worker/facts.js';

const previousHome = process.env.OVERDECK_HOME;
let home: string;
let workspace: string;

const machine = (environmentId: string, actor: 'operator' | { agentId: string } = { agentId: 'agent-pan-9' }): DashboardCredential => ({
  kind: 'machine', tokenId: 't', environmentId, scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator',
});

function doorDeps(start: WorkerDoorDeps['start']): WorkerDoorDeps {
  return {
    listProjects: async () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/srv/overdeck', github_repo: 'eltmon/overdeck' } as ProjectConfig }],
    thisLabel: async () => 'desk',
    projectKeyForIssue: async (issueId) => (issueId.toUpperCase().startsWith('PAN-') ? 'overdeck' : null),
    start,
  };
}

/** The real startWorker with the pane launch faked, so worker.json is written for real. */
const realStart = (options: StartWorkerOptions) => startWorker(options, {
  spawnRun: async (_issue, _role, launch) => {
    writeFileSync(join(workerDir(launch.agentId), 'state.json'), '{}');
    return {} as AgentState;
  },
  resolveWorkspace: () => workspace,
  findPrimaryCheckout: async () => null,
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4651-work-worker-'));
  process.env.OVERDECK_HOME = home;
  workspace = join(home, 'workspaces', 'feature-pan-9');
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('worker work door (D-4651-3)', () => {
  it('ac5: writes startedBy into worker.json with the caller environment and parent', async () => {
    const response = readJsonResponse(await handleWorkWorker(machine('env-laptop'), {
      gitOrigin: 'github.com/eltmon/overdeck', issueId: 'pan-9', prompt: 'Run the suite.', readOnly: true, parentId: 'agent-pan-9',
    }, doorDeps(realStart)));
    expect(response.status).toBe(200);
    const id = (response.body as { id: string }).id;
    expect(existsSync(workerFactsPath(id))).toBe(true);
    const facts = JSON.parse(readFileSync(workerFactsPath(id), 'utf8')) as Record<string, unknown>;
    expect(facts).toMatchObject({ issueId: 'PAN-9', parentId: null, startedBy: { environmentId: 'env-laptop', parentId: 'agent-pan-9' } });
  });

  it('answers 404 project-missing when the issue has no project or the slugs differ', async () => {
    const start = vi.fn(realStart);
    const other = readJsonResponse(await handleWorkWorker(machine('env-laptop'), { gitOrigin: 'github.com/x/y', issueId: 'PAN-9', prompt: 'x' }, doorDeps(start)));
    expect(other).toMatchObject({ status: 404, body: { code: 'project-missing', machine: 'desk' } });
    const none = readJsonResponse(await handleWorkWorker(machine('env-laptop'), { gitOrigin: 'github.com/eltmon/overdeck', issueId: 'ZZZ-1', prompt: 'x' }, doorDeps(start)));
    expect(none).toMatchObject({ status: 404, body: { code: 'project-missing' } });
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a non-machine credential and a malformed body', async () => {
    const start = vi.fn(realStart);
    expect(readJsonResponse(await handleWorkWorker({ kind: 'token', tokenId: 'k', scopes: ['operate'] }, {}, doorDeps(start))))
      .toMatchObject({ status: 403, body: { code: 'machine-only' } });
    expect(readJsonResponse(await handleWorkWorker(machine('env-laptop'), { gitOrigin: null, issueId: 'PAN-9' }, doorDeps(start))).status).toBe(400);
    expect(readJsonResponse(await handleWorkWorker(machine('env-laptop'), { gitOrigin: null, issueId: 'PAN-9', prompt: 'x', parentId: 'bad id!' }, doorDeps(start))).status).toBe(400);
  });

  it('ac5: an agent actor stopping a worker another machine started gets 403 agent-fenced', async () => {
    const started = readJsonResponse(await handleWorkWorker(machine('env-laptop'), {
      gitOrigin: 'github.com/eltmon/overdeck', issueId: 'PAN-9', prompt: 'x', readOnly: true,
    }, doorDeps(realStart)));
    const id = (started.body as { id: string }).id;
    const stop = vi.fn(async () => undefined);
    const deps = { readFacts: readWorkerFacts, stop } as unknown as WorkerFollowDeps;
    expect(readJsonResponse(await handleWorkerStop(id, machine('env-other'), deps))).toMatchObject({ status: 403, body: { code: 'agent-fenced' } });
    expect(stop).not.toHaveBeenCalled();
    expect(readJsonResponse(await handleWorkerStop(id, machine('env-laptop'), deps))).toEqual({ status: 200, body: { stopped: true } });
    expect(readJsonResponse(await handleWorkerStop(id, machine('env-other', 'operator'), deps)).status).toBe(200);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
