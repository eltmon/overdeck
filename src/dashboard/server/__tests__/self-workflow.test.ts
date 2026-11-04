/**
 * PAN-4927 W-SELF2 WI-2, WI-3: the self workflow route file's shared
 * helpers, `task_claim`, `task_done` and `task_block`, at the handler level,
 * under fake timers, and through the real remote request gate and
 * access-token registry.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClaimantId } from '../../../lib/xbrief/claim-check.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { SelfCallerDeps } from '../self-caller.js';
import type { SelfJobRunInput, SelfJobRunResult } from '../services/self-jobs.js';

const LAN_PEER = '192.0.2.46';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4937-self-workflow-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { requiredScopeFor } = await import('../route-scopes.js');
const { createSelfJobs } = await import('../services/self-jobs.js');
const {
  badRequest,
  handleSelfDone,
  handleSelfHandoff,
  handleSelfTaskBlock,
  handleSelfTaskClaim,
  handleSelfTaskDone,
  makeSelfWorkflowRouteLayer,
  parseSelfBody,
  requiredBodyString,
} = await import('../routes/self-workflow.js');

const callerDeps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId === 'agent-pan-1' || agentId === 'agent-pan-2' ? { workspace: '/w/feature-pan-1', issueId: 'PAN-1' } : null),
  getConversationByName: () => null,
};

const agentCredential = (agentId: string): DashboardCredential => ({
  kind: 'token',
  tokenId: `tok-${agentId}`,
  scopes: ['tell'],
  agentId,
  agentKind: 'agent',
  role: 'work',
});

const conversationCredential = (name: string): DashboardCredential => ({
  kind: 'token',
  tokenId: `tok-${name}`,
  scopes: ['tell'],
  agentId: name,
  agentKind: 'conversation',
  role: 'conversation',
});

function controlledJobs() {
  const resolvers: Array<(result: SelfJobRunResult) => void> = [];
  const recorded: SelfJobRunInput[] = [];
  let next = 0;
  const jobs = createSelfJobs({
    runner: (input: SelfJobRunInput) => {
      recorded.push(input);
      return new Promise<SelfJobRunResult>((resolve) => resolvers.push(resolve));
    },
    newId: () => `job-${++next}`,
  });
  const finish = (index: number, result: Partial<SelfJobRunResult> = {}) =>
    resolvers[index]({ exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', error: null, ...result });
  return { jobs, recorded, finish };
}

async function send(
  app: Layer.Layer<never, never, never>,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const request = HttpServerRequest.fromWeb(
    new Request(`http://dashboard.test${path}`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  ).modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(
    Effect.scoped(Effect.flatMap(HttpRouter.toHttpEffect(app), (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request))),
  );
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

describe('self workflow body and string helpers', () => {
  it('parseSelfBody: blank is {}, a JSON object is itself, anything else is null', () => {
    expect(parseSelfBody('')).toEqual({});
    expect(parseSelfBody('   ')).toEqual({});
    expect(parseSelfBody('{"itemId":"a"}')).toEqual({ itemId: 'a' });
    expect(parseSelfBody('[1]')).toBeNull();
    expect(parseSelfBody('not json')).toBeNull();
    expect(parseSelfBody('null')).toBeNull();
    expect(parseSelfBody('"x"')).toBeNull();
  });

  it('requiredBodyString: missing, blank and too-long are refused by field name', () => {
    expect(requiredBodyString({}, 'itemId', 10)).toEqual({ ok: false, result: badRequest('itemId is required and must be a non-empty string') });
    expect(requiredBodyString({ itemId: '  ' }, 'itemId', 10)).toEqual({ ok: false, result: badRequest('itemId is required and must be a non-empty string') });
    expect(requiredBodyString({ itemId: 'x'.repeat(11) }, 'itemId', 10)).toEqual({ ok: false, result: badRequest('itemId must be at most 10 characters') });
    expect(requiredBodyString({ itemId: 'item-a' }, 'itemId', 10)).toEqual({ ok: true, value: 'item-a' });
  });
});

describe.each([
  { verb: 'claim' as const, handler: handleSelfTaskClaim, argvVerb: ['task', 'claim'] },
  { verb: 'done' as const, handler: handleSelfTaskDone, argvVerb: ['task', 'done'] },
])('handleSelfTask$verb', ({ handler, argvVerb }) => {
  it('builds argv from the caller issue and itemId, never the body issueId', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handler(agentCredential('agent-pan-1'), '{"itemId":"item-a","issueId":"PAN-999"}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    const result = await promise;
    expect(result.status).toBe(200);
    expect(recorded[0]?.args.slice(1)).toEqual([...argvVerb, 'PAN-1', 'item-a', '--json']);
    expect(recorded[0]?.cwd).toBe('/w/feature-pan-1');
    expect(resolveClaimantId(recorded[0]?.env)).toBe('agent-pan-1');
  });

  it('refuses [1] with 400 bad-body', async () => {
    const { jobs } = controlledJobs();
    expect(await handler(agentCredential('agent-pan-1'), '[1]', undefined, { jobs, caller: callerDeps })).toEqual({
      status: 400,
      body: { error: 'request body must be a JSON object', code: 'bad-body' },
    });
  });

  it('refuses {} with 400 bad-request', async () => {
    const { jobs } = controlledJobs();
    expect(await handler(agentCredential('agent-pan-1'), '{}', undefined, { jobs, caller: callerDeps })).toEqual({
      status: 400,
      body: { error: 'itemId is required and must be a non-empty string', code: 'bad-request' },
    });
  });

  it('refuses itemId --steal with 400 bad-job-arg and starts no job', async () => {
    const { jobs, recorded } = controlledJobs();
    const result = await handler(agentCredential('agent-pan-1'), '{"itemId":"--steal"}', undefined, { jobs, caller: callerDeps });
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe('bad-job-arg');
    expect(recorded).toEqual([]);
  });

  it('refuses an agent without an issue with 409 no-issue', async () => {
    const { jobs } = controlledJobs();
    const deps: SelfCallerDeps = { getAgentState: () => ({ workspace: '/w/x', issueId: '' }), getConversationByName: () => null };
    expect(await handler(agentCredential('agent-pan-1'), '{"itemId":"item-a"}', undefined, { jobs, caller: deps })).toEqual({
      status: 409,
      body: { error: 'this agent has no issue', code: 'no-issue' },
    });
  });
});

describe('handleSelfTaskBlock', () => {
  it('builds argv with each on ref as its own --on flag', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfTaskBlock(agentCredential('agent-pan-1'), '{"itemId":"item-a","on":["PAN-2","#45"]}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    const result = await promise;
    expect(result.status).toBe(200);
    expect(recorded[0]?.args.slice(1)).toEqual(['task', 'block', 'PAN-1', 'item-a', '--on=PAN-2', '--on=#45', '--json']);
  });

  it('builds argv with no --on flags when on is absent', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfTaskBlock(agentCredential('agent-pan-1'), '{"itemId":"item-a"}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    await promise;
    expect(recorded[0]?.args.slice(1)).toEqual(['task', 'block', 'PAN-1', 'item-a', '--json']);
  });

  it('turns an on value of --steal into a single --on=--steal argv element', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfTaskBlock(agentCredential('agent-pan-1'), '{"itemId":"item-a","on":["--steal"]}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    await promise;
    expect(recorded[0]?.args.slice(1)).toEqual(['task', 'block', 'PAN-1', 'item-a', '--on=--steal', '--json']);
  });

  it('refuses 21 refs, a non-array on, and an empty-string ref with 400 bad-request and starts no job', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `PAN-${i}`);
    for (const on of [tooMany, 'not-an-array', ['']]) {
      const { jobs, recorded } = controlledJobs();
      const result = await handleSelfTaskBlock(agentCredential('agent-pan-1'), JSON.stringify({ itemId: 'item-a', on }), undefined, { jobs, caller: callerDeps });
      expect(result).toEqual({ status: 400, body: { error: 'on must be a list of at most 20 issue or PR references', code: 'bad-request' } });
      expect(recorded).toEqual([]);
    }
  });
});

describe('handleSelfDone', () => {
  it('builds argv done <caller issue> only, ignoring body fields', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfDone(agentCredential('agent-pan-1'), '{"issueId":"PAN-9","force":true}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    const result = await promise;
    expect(result.status).toBe(200);
    expect(recorded[0]?.args.slice(1)).toEqual(['done', 'PAN-1']);
  });

  it('refuses a caller without an issue with 409 no-issue', async () => {
    const { jobs } = controlledJobs();
    const deps: SelfCallerDeps = { getAgentState: () => ({ workspace: '/w/x', issueId: '' }), getConversationByName: () => null };
    expect(await handleSelfDone(agentCredential('agent-pan-1'), '{}', undefined, { jobs, caller: deps })).toEqual({
      status: 409,
      body: { error: 'this agent has no issue', code: 'no-issue' },
    });
  });
});

describe('handleSelfHandoff', () => {
  it('builds argv handoff self --title=<title> -- <focus>', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfHandoff(agentCredential('agent-pan-1'), '{"focus":"Read .pan/brief.md","title":"Next step"}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    const result = await promise;
    expect(result.status).toBe(200);
    expect(recorded[0]?.args.slice(1)).toEqual(['handoff', 'self', '--title=Next step', '--', 'Read .pan/brief.md']);
  });

  it('omits --title when absent', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfHandoff(agentCredential('agent-pan-1'), '{"focus":"Read .pan/brief.md"}', undefined, { jobs, caller: callerDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    await promise;
    expect(recorded[0]?.args.slice(1)).toEqual(['handoff', 'self', '--', 'Read .pan/brief.md']);
  });

  it('keeps a hostile focus and title each as one argv element, never read as a flag', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const promise = handleSelfHandoff(
      agentCredential('agent-pan-1'),
      JSON.stringify({ focus: '--cwd / --allow-primary', title: '--allow-primary' }),
      undefined,
      { jobs, caller: callerDeps },
    );
    finish(0, { exitCode: 0, stdout: 'ok' });
    await promise;
    const argv = recorded[0]!.args.slice(1);
    expect(argv).toEqual(['handoff', 'self', '--title=--allow-primary', '--', '--cwd / --allow-primary']);
    expect(argv.slice(0, -1)).not.toContain('--allow-primary');
    expect(argv.slice(0, -1).some((element) => element.startsWith('--cwd'))).toBe(false);
  });

  it('refuses a 10,001-character focus and a blank title with 400 bad-request, starting no job', async () => {
    const { jobs: jobsA, recorded: recordedA } = controlledJobs();
    const tooLong = await handleSelfHandoff(agentCredential('agent-pan-1'), JSON.stringify({ focus: 'x'.repeat(10_001) }), undefined, { jobs: jobsA, caller: callerDeps });
    expect(tooLong).toEqual({ status: 400, body: { error: 'focus must be at most 10000 characters', code: 'bad-request' } });
    expect(recordedA).toEqual([]);

    const { jobs: jobsB, recorded: recordedB } = controlledJobs();
    const blankTitle = await handleSelfHandoff(agentCredential('agent-pan-1'), JSON.stringify({ focus: 'ok', title: '  ' }), undefined, { jobs: jobsB, caller: callerDeps });
    expect(blankTitle).toEqual({ status: 400, body: { error: 'title is required and must be a non-empty string', code: 'bad-request' } });
    expect(recordedB).toEqual([]);
  });

  it.each(['--yolo', '--no-yolo', '--yolo=true'])('refuses a focus of %s with 400 bad-request, starting no job', async (focus) => {
    const { jobs, recorded } = controlledJobs();
    const result = await handleSelfHandoff(agentCredential('agent-pan-1'), JSON.stringify({ focus }), undefined, { jobs, caller: callerDeps });
    expect(result).toEqual({ status: 400, body: { error: 'focus must not start with --yolo or --no-yolo', code: 'bad-request' } });
    expect(recorded).toEqual([]);
  });

  it('runs a conversation caller in its cwd with OVERDECK_AGENT_ID set to its tmux session', async () => {
    const { jobs, recorded, finish } = controlledJobs();
    const conversationDeps: SelfCallerDeps = {
      getAgentState: () => null,
      getConversationByName: (name) => (name === 'conv-abc' ? { cwd: '/home/u/proj', tmuxSession: 'conv-abc', issueId: null } : null),
    };
    const promise = handleSelfHandoff(conversationCredential('conv-abc'), '{"focus":"Read .pan/brief.md"}', undefined, { jobs, caller: conversationDeps });
    finish(0, { exitCode: 0, stdout: 'ok' });
    await promise;
    expect(recorded[0]?.cwd).toBe('/home/u/proj');
    expect(recorded[0]?.env.OVERDECK_AGENT_ID).toBe('conv-abc');
  });
});

describe('waits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is still pending at 49,999 ms and resolves at 50,000 ms with running and next', async () => {
    const { jobs } = controlledJobs();
    const promise = handleSelfTaskClaim(agentCredential('agent-pan-1'), '{"itemId":"item-a"}', undefined, { jobs, caller: callerDeps });
    let settled = false;
    void promise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(49_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'running', next: { tool: 'wait_job', arguments: { jobId: expect.any(String) } } });
  });
});

describe('self workflow routes through the gate', () => {
  it('returns 403 not-an-agent-token for a plain kind token with tell', async () => {
    const { jobs } = controlledJobs();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfWorkflowRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'plain', scopes: ['tell'], kind: 'token' });
    const response = await send(app, 'POST', '/api/self/tasks/claim', bearer(token), { itemId: 'item-a' });
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'self routes need an agent token', code: 'not-an-agent-token' });
  });

  it('returns 403 missingScope tell for a read:state-only token', async () => {
    const { jobs } = controlledJobs();
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfWorkflowRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({ name: 'reader', scopes: ['read:state'], kind: 'token' });
    const response = await send(app, 'POST', '/api/self/tasks/claim', bearer(token), { itemId: 'item-a' });
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ missingScope: 'tell' });
  });

  it('answers 200 for an agent token with tell on claim and done', async () => {
    const jobs = createSelfJobs({ runner: async () => ({ exitCode: 0, signal: null, timedOut: false, stdout: 'ok', stderr: '', error: null }) });
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfWorkflowRouteLayer({ jobs, caller: callerDeps }));
    const { token } = await createAccessToken({
      name: 'agent:work:agent-pan-1',
      kind: 'token',
      scopes: ['tell'],
      agentId: 'agent-pan-1',
      agentKind: 'agent',
      role: 'work',
    });

    const claimResponse = await send(app, 'POST', '/api/self/tasks/claim', bearer(token), { itemId: 'item-a' });
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.json).toMatchObject({ status: 'done', exitCode: 0, stdout: 'ok' });

    const doneResponse = await send(app, 'POST', '/api/self/tasks/done', bearer(token), { itemId: 'item-a' });
    expect(doneResponse.status).toBe(200);
    expect(doneResponse.json).toMatchObject({ status: 'done', exitCode: 0, stdout: 'ok' });
  });

  it('requires tell for all three task routes and handoff, and operate for done', () => {
    expect(requiredScopeFor('POST', '/api/self/tasks/claim')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/self/tasks/done')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/self/tasks/block')).toBe('tell');
    expect(requiredScopeFor('POST', '/api/self/done')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/self/handoff')).toBe('tell');
  });

  it('refuses a review-role agent token with 403 missingScope operate on /api/self/done, and allows a work agent token', async () => {
    const jobs = createSelfJobs({ runner: async () => ({ exitCode: 0, signal: null, timedOut: false, stdout: 'ok', stderr: '', error: null }) });
    const app = Layer.mergeAll(remoteRequestGateLayer, makeSelfWorkflowRouteLayer({ jobs, caller: callerDeps }));
    const { token: reviewToken } = await createAccessToken({
      name: 'agent:review:agent-pan-1',
      kind: 'token',
      scopes: ['read:events', 'read:state', 'read:conversations', 'tell'],
      agentId: 'agent-pan-1',
      agentKind: 'agent',
      role: 'review',
    });
    const reviewResponse = await send(app, 'POST', '/api/self/done', bearer(reviewToken));
    expect(reviewResponse.status).toBe(403);
    expect(reviewResponse.json).toMatchObject({ missingScope: 'operate' });

    const { token: workToken } = await createAccessToken({
      name: 'agent:work:agent-pan-1',
      kind: 'token',
      scopes: ['tell', 'operate'],
      agentId: 'agent-pan-1',
      agentKind: 'agent',
      role: 'work',
    });
    const workResponse = await send(app, 'POST', '/api/self/done', bearer(workToken));
    expect(workResponse.status).toBe(200);
    expect(workResponse.json).toMatchObject({ status: 'done', exitCode: 0, stdout: 'ok' });
  });
});
