/**
 * PAN-4927 W-SELF1 WI-4: the self job routes through the real remote request
 * gate and access-token registry under a temporary OVERDECK_HOME, plus the
 * handlers' caller, timeout and ownership checks with injected deps.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SelfCaller, SelfCallerDeps } from '../self-caller.js';
import type { SelfJobRunInput, SelfJobRunResult } from '../services/self-jobs.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';

const LAN_PEER = '192.0.2.45';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4936-self-jobs-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { requiredScopeFor } = await import('../route-scopes.js');
const { createSelfJobs } = await import('../services/self-jobs.js');
const { handleSelfJobGet, handleSelfJobWait, makeSelfJobsRouteLayer, parseWaitTimeoutMs } = await import('../routes/self-jobs.js');

const callerDeps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId === 'agent-pan-1' || agentId === 'agent-pan-2' ? { workspace: `/w/${agentId}`, issueId: 'PAN-1' } : null),
  getConversationByName: () => null,
};

const agentCaller: SelfCaller = { agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', cwd: '/w/agent-pan-1', issueId: 'PAN-1', tmuxSession: null };

const agentCredential = (agentId: string): DashboardCredential => ({
  kind: 'token',
  tokenId: `tok-${agentId}`,
  scopes: ['read:state'],
  agentId,
  agentKind: 'agent',
  role: 'work',
});

function controlledJobs() {
  const resolvers: Array<(result: SelfJobRunResult) => void> = [];
  let next = 0;
  const jobs = createSelfJobs({
    runner: (_input: SelfJobRunInput) => new Promise<SelfJobRunResult>((resolve) => resolvers.push(resolve)),
    newId: () => `job-${++next}`,
  });
  const finish = (index: number, result: Partial<SelfJobRunResult> = {}) =>
    resolvers[index]({ exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', error: null, ...result });
  return { jobs, finish };
}

async function send(app: Layer.Layer<never, never, never>, path: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method: 'GET', headers }))
    .modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, json: text ? JSON.parse(text) : null };
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  _resetDashboardSessionTokenForTests();
});

describe('self job routes through the gate', () => {
  it('refuses a plain read:state token with 403 not-an-agent-token on both routes', async () => {
    const { jobs } = controlledJobs();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfJobsRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'plain', scopes: ['read:state'], kind: 'token' });
    for (const path of ['/api/self/jobs/abc', '/api/self/jobs/abc/wait']) {
      const response = await send(app, path, bearer(token));
      expect(response.status, path).toBe(403);
      expect(response.json, path).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
    }
  });

  it('refuses a token without read:state at the gate', async () => {
    const { jobs } = controlledJobs();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfJobsRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'costs', scopes: ['read:costs'], kind: 'token' });
    const response = await send(app, '/api/self/jobs/abc', bearer(token));
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ missingScope: 'read:state' });
  });

  it('answers an agent token: 404 for an unknown job, 200 done for its own finished job', async () => {
    const { jobs, finish } = controlledJobs();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfJobsRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'a', scopes: ['read:state'], kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work' });

    const unknown = await send(app, '/api/self/jobs/nope', bearer(token));
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual({ error: 'no such job', code: 'unknown-job' });

    const started = jobs.start(agentCaller, 'done', [{ ref: 'PAN-1' }]);
    if (!started.ok) throw new Error('start failed');
    finish(0, { exitCode: 0, stdout: 'ok' });
    await jobs.wait(started.jobId, agentCaller, 1);

    for (const path of [`/api/self/jobs/${started.jobId}`, `/api/self/jobs/${started.jobId}/wait?timeoutMs=10`]) {
      const response = await send(app, path, bearer(token));
      expect(response.status, path).toBe(200);
      expect(response.json, path).toMatchObject({ status: 'done', jobId: started.jobId, verb: 'done', exitCode: 0, stdout: 'ok' });
    }
  });
});

describe('self job handlers', () => {
  it('hides another agent\'s job as unknown-job', async () => {
    const { jobs } = controlledJobs();
    const started = jobs.start(agentCaller, 'done');
    if (!started.ok) throw new Error('start failed');
    const other = agentCredential('agent-pan-2');
    expect(handleSelfJobGet(other, started.jobId, { jobs, caller: callerDeps })).toEqual({ status: 404, body: { error: 'no such job', code: 'unknown-job' } });
    await expect(handleSelfJobWait(other, started.jobId, '1', undefined, { jobs, caller: callerDeps })).resolves.toEqual({
      status: 404,
      body: { error: 'no such job', code: 'unknown-job' },
    });
  });

  it.each(['0', '50001', 'abc', '1.5', '', '-1', '000001'])('refuses timeoutMs %j with 400 bad-timeout', async (raw) => {
    const { jobs } = controlledJobs();
    await expect(handleSelfJobWait(agentCredential('agent-pan-1'), 'job-1', raw, undefined, { jobs, caller: callerDeps })).resolves.toEqual({
      status: 400,
      body: { error: 'timeoutMs must be an integer from 1 to 50000', code: 'bad-timeout' },
    });
  });

  it('checks the caller before the timeout', async () => {
    const { jobs } = controlledJobs();
    const result = await handleSelfJobWait(null, 'job-1', 'abc', undefined, { jobs, caller: callerDeps });
    expect(result.status).toBe(403);
    const gone = await handleSelfJobWait(agentCredential('agent-pan-9'), 'job-1', 'abc', undefined, { jobs, caller: callerDeps });
    expect(gone).toEqual({ status: 404, body: { error: 'the agent for this token no longer exists', code: 'agent-gone' } });
  });

  it('parses timeoutMs: null is the 50 s chunk, 1 and 50000 are the bounds', () => {
    expect(parseWaitTimeoutMs(null)).toEqual({ ok: true, value: 50_000 });
    expect(parseWaitTimeoutMs('1')).toEqual({ ok: true, value: 1 });
    expect(parseWaitTimeoutMs('50000')).toEqual({ ok: true, value: 50_000 });
  });

  it('answers a running job with next, after an aborted wait', async () => {
    const { jobs } = controlledJobs();
    const started = jobs.start(agentCaller, 'done');
    if (!started.ok) throw new Error('start failed');
    const controller = new AbortController();
    controller.abort();
    const result = await handleSelfJobWait(agentCredential('agent-pan-1'), started.jobId, null, controller.signal, { jobs, caller: callerDeps });
    expect(result).toEqual({
      status: 200,
      body: { status: 'running', jobId: started.jobId, verb: 'done', startedAt: expect.any(String), next: { tool: 'wait_job', arguments: { jobId: started.jobId } } },
    });
  });

  it('maps both routes to read:state', () => {
    expect(requiredScopeFor('GET', '/api/self/jobs/x')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/self/jobs/x/wait')).toBe('read:state');
  });
});
