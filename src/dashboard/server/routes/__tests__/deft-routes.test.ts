/**
 * PAN-4849 WI-2: the Deft read routes and the pipeline switch route. The Deft
 * pipeline check, the workspace lookup, the project list and the `pan`
 * spawner are mocked; the state reader runs against the fixture tree.
 */
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FIXTURE_DIR = fileURLToPath(new URL('../../../../lib/deft/__tests__/fixtures/directive', import.meta.url));
const GOLDEN_PATH = fileURLToPath(new URL('../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json', import.meta.url));

const mocks = vi.hoisted(() => ({
  isDeftPipelineIssue: vi.fn(),
  getIssueWorkspacePath: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  listProjectsAsync: vi.fn(),
  emitActivityEntry: vi.fn(),
  deliverAgentMessage: vi.fn(),
  clearDeftPendingCache: vi.fn(),
}));

vi.mock('../../../../lib/deft/issue-pipeline.js', () => ({ isDeftPipelineIssue: mocks.isDeftPipelineIssue }));
vi.mock('../../../../lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: mocks.getIssueWorkspacePath,
  resolveProjectForIssue: mocks.resolveProjectForIssue,
}));
vi.mock('../../../../lib/deft/archive.js', () => ({ isNativeDirectiveProject: async () => false }));
vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('../../../../lib/agents/delivery.js', () => ({ deliverAgentMessage: mocks.deliverAgentMessage }));
vi.mock('../../../../lib/deft/pending.js', () => ({ clearDeftPendingCache: mocks.clearDeftPendingCache }));
vi.mock('../../../../lib/projects.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  listProjectsAsync: mocks.listProjectsAsync,
}));

const { deftRouteLayer, setDeftPipelineSpawnerForTests, setDeftReviewCycleDepsForTests } = await import('../deft.js');

const GOLDEN = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deft-routes-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function call(method: string, path: string, init: { body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'http://localhost:3011';
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(deftRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  stderr = new EventEmitter();
  unref = vi.fn();
  constructor() {
    super();
    this.stdout.resume = () => undefined;
  }
}

let children: FakeChild[];
const spawner = vi.fn((_args: string[], _env: Record<string, string>) => {
  const child = new FakeChild();
  children.push(child);
  return child as unknown as ChildProcess;
});

beforeEach(() => {
  vi.clearAllMocks();
  children = [];
  setDeftPipelineSpawnerForTests(spawner);
  mocks.isDeftPipelineIssue.mockResolvedValue(true);
  mocks.getIssueWorkspacePath.mockReturnValue(FIXTURE_DIR);
  mocks.resolveProjectForIssue.mockReturnValue({ name: 'p', path: '/tmp/p' });
  mocks.listProjectsAsync.mockResolvedValue([]);
});

afterEach(() => {
  // Let every switch finish so the in-memory running set is empty for the next test.
  for (const child of children) child.emit('exit', 0);
  setDeftPipelineSpawnerForTests(null);
});

describe('GET /api/issues/:id/deft', () => {
  it('returns 400 for an invalid issue id', async () => {
    expect((await call('GET', '/api/issues/not-an-id/deft')).status).toBe(400);
  });

  it('returns 404 for an issue that does not run on Deft', async () => {
    mocks.isDeftPipelineIssue.mockResolvedValue(false);
    const res = await call('GET', '/api/issues/PAN-1/deft');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'PAN-1 does not run on Deft' });
  });

  it('returns 404 when the Deft issue has no workspace', async () => {
    mocks.getIssueWorkspacePath.mockReturnValue(null);
    const res = await call('GET', '/api/issues/PAN-1/deft');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'no workspace' });
  });

  it('returns the state read from the workspace', async () => {
    // The golden's overdue flags are computed at 2026-11-02T18:00Z.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T18:00:00Z'));
    try {
      const res = await call('GET', '/api/issues/pan-1/deft');
      expect(res.status).toBe(200);
      expect(res.json).toEqual(GOLDEN);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /api/deft/issues', () => {
  it('summarizes every issue whose override file holds pipeline: deft', async () => {
    const project = mkdtempSync(join(scratch, 'project-'));
    const overrides = join(project, '.pan', 'skill-overrides');
    mkdirSync(overrides, { recursive: true });
    writeFileSync(join(overrides, 'PAN-1.yaml'), 'pipeline: deft\n');
    writeFileSync(join(overrides, 'PAN-2.yaml'), 'pipeline: deft\n');
    writeFileSync(join(overrides, 'PAN-3.yaml'), 'skills: {}\n');
    mocks.listProjectsAsync.mockResolvedValue([{ key: 'p', config: { name: 'p', path: project } }]);
    mocks.getIssueWorkspacePath.mockImplementation((id: string) => (id === 'PAN-1' ? FIXTURE_DIR : null));

    const res = await call('GET', '/api/deft/issues');

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      issues: [
        {
          issueId: 'PAN-1',
          scopeCounts: { proposed: 1, pending: 1, active: 1, completed: 1, cancelled: 1 },
          specDriftUnresolved: 1,
          installDrift: 0,
          handoffState: 'pr_open',
          openEscalations: 3,
        },
        { issueId: 'PAN-2', scopeCounts: {}, specDriftUnresolved: 0, installDrift: 0, handoffState: null, openEscalations: 0 },
      ],
    });
  });
});

describe('POST /api/issues/:id/pipeline', () => {
  it('refuses a missing Origin with 403', async () => {
    const res = await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft' }, origin: null });
    expect(res.status).toBe(403);
    expect(spawner).not.toHaveBeenCalled();
  });

  it('returns 400 for a bad body', async () => {
    expect((await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'other' } })).status).toBe(400);
    expect((await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft', start: 'yes' } })).status).toBe(400);
    expect(spawner).not.toHaveBeenCalled();
  });

  it('returns 404 and spawns nothing for an issue no registered project owns', async () => {
    mocks.resolveProjectForIssue.mockReturnValue(null);
    const res = await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft' } });
    expect(res).toEqual({ status: 404, json: { error: 'no registered project owns PAN-1' } });
    expect(spawner).not.toHaveBeenCalled();
  });

  it('accepts an issue with a registered project but no workspace yet', async () => {
    mocks.getIssueWorkspacePath.mockReturnValue(null);
    expect((await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft' } })).status).toBe(202);
  });

  it('answers 202 and spawns pan skills deft use once', async () => {
    const res = await call('POST', '/api/issues/pan-1/pipeline', { body: { pipeline: 'deft', start: true } });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ accepted: true, issueId: 'PAN-1', pipeline: 'deft' });
    expect(spawner).toHaveBeenCalledTimes(1);
    expect(spawner.mock.calls[0]![0]).toEqual(['skills', 'deft', 'use', 'PAN-1', '--start']);
  });

  it('spawns back without --start for the Overdeck pipeline', async () => {
    await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'overdeck', start: true } });
    expect(spawner.mock.calls[0]![0]).toEqual(['skills', 'deft', 'back', 'PAN-1']);
  });

  it('returns 409 for a second switch before the first exits, then accepts after exit', async () => {
    expect((await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft' } })).status).toBe(202);
    const second = await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'overdeck' } });
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ error: 'a pipeline switch for PAN-1 is already running' });
    expect(spawner).toHaveBeenCalledTimes(1);

    children[0]!.emit('exit', 0);
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith({ source: 'dashboard', level: 'info', message: 'Switched PAN-1 to deft', issueId: 'PAN-1' });
    expect((await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'overdeck' } })).status).toBe(202);
  });

  it('records the last stderr lines when the switch fails', async () => {
    await call('POST', '/api/issues/PAN-1/pipeline', { body: { pipeline: 'deft' } });
    children[0]!.stderr.emit('data', 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n');
    children[0]!.emit('exit', 1);
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith({
      source: 'dashboard',
      level: 'error',
      message: 'Pipeline switch for PAN-1 failed: line 2\nline 3\nline 4\nline 5\nline 6',
      issueId: 'PAN-1',
    });
  });
});

describe('POST /api/issues/:id/deft/escalations/:escId/resolve', () => {
  const ESC = 'esc-20261102120100-bbbbbb';
  const resolvePath = (escId = ESC) => `/api/issues/PAN-1/deft/escalations/${escId}/resolve`;

  beforeEach(() => {
    const copy = mkdtempSync(join(scratch, 'wt-'));
    cpSync(FIXTURE_DIR, copy, { recursive: true });
    mocks.getIssueWorkspacePath.mockReturnValue(copy);
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'herdr' });
  });

  it('refuses a missing Origin and a bad decision', async () => {
    expect((await call('POST', resolvePath(), { body: { decision: 'approved' }, origin: null })).status).toBe(403);
    expect((await call('POST', resolvePath(), { body: { decision: 'maybe' } })).status).toBe(400);
  });

  it('returns 404 for a non-Deft issue or an unknown escalation', async () => {
    expect((await call('POST', resolvePath('..%2Fx'), { body: { decision: 'approved' } })).status).toBe(404);
    expect((await call('POST', resolvePath('esc-20990101000000-ffffff'), { body: { decision: 'approved' } })).status).toBe(404);
    mocks.isDeftPipelineIssue.mockResolvedValue(false);
    expect((await call('POST', resolvePath(), { body: { decision: 'approved' } })).status).toBe(404);
  });

  it('resolves once, tells the agent, and returns 409 the second time', async () => {
    const first = await call('POST', resolvePath(), { body: { decision: 'answered', answer: 'Dense rows' } });
    expect(first.status).toBe(200);
    expect(mocks.clearDeftPendingCache).toHaveBeenCalledWith(mocks.getIssueWorkspacePath());
    expect(first.json).toEqual({ resolved: true, delivered: true });
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-1',
      `Operator resolved Deft escalation ${ESC}: answered — Dense rows`,
      'deft-escalation-answer',
    );

    const second = await call('POST', resolvePath(), { body: { decision: 'answered', answer: 'Roomy rows' } });
    expect(second.status).toBe(409);
  });

  it('accepts a custom Deft escalation id', async () => {
    const copy = mocks.getIssueWorkspacePath() as string;
    const file = join(copy, '.deft', 'escalations', 'deploy-approval.json');
    writeFileSync(file, JSON.stringify({ id: 'deploy-approval', agentId: 'impl-1', type: 'approval', title: 't', body: '', createdAt: '2026-11-02T12:00:00Z', slaHours: 4, status: 'open', dangerous: false }));
    expect((await call('POST', resolvePath('deploy-approval'), { body: { decision: 'approved' } })).status).toBe(200);
  });

  it('reports a failed delivery after resolving', async () => {
    mocks.deliverAgentMessage.mockResolvedValue({ ok: false, path: 'herdr', failure: 'no pane' });
    const res = await call('POST', resolvePath(), { body: { decision: 'dismissed' } });
    expect(res.json).toEqual({ resolved: true, delivered: false, deliveryError: 'no pane' });
  });
});

describe('POST /api/issues/:id/deft/scopes/signoff', () => {
  const body = { scopePath: 'xbrief/active/ui.xbrief.json', itemId: 'u2' };
  let copy: string;

  beforeEach(() => {
    copy = mkdtempSync(join(scratch, 'wt-'));
    cpSync(FIXTURE_DIR, copy, { recursive: true });
    mocks.getIssueWorkspacePath.mockReturnValue(copy);
  });

  it('signs the agent disposition once, then reports not-needed', async () => {
    const first = await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body });
    expect(first).toEqual({ status: 200, json: { result: 'signed' } });
    const scope = JSON.parse(readFileSync(join(copy, body.scopePath), 'utf8'));
    expect(scope.plan.items[1]['x-directive/disposition'].provenance).toEqual({ kind: 'human-event', actor: 'overdeck:dashboard' });
    expect((await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body })).json).toEqual({ result: 'not-needed' });
  });

  it('refuses a bad body, a missing origin, an unsafe path and a non-Deft issue', async () => {
    expect((await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body: { scopePath: 'x' } })).status).toBe(400);
    expect((await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body, origin: null })).status).toBe(403);
    expect((await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body: { ...body, scopePath: 'xbrief/../x.json' } })).status).toBe(404);
    mocks.isDeftPipelineIssue.mockResolvedValue(false);
    expect((await call('POST', '/api/issues/PAN-1/deft/scopes/signoff', { body })).status).toBe(404);
  });
});

describe('GET /api/issues/:id/deft/review-cycle', () => {
  const REVIEW_FIXTURES = fileURLToPath(new URL('../../../../lib/deft/__tests__/fixtures/review-cycle/main.json', import.meta.url));
  const MAIN = JSON.parse(readFileSync(REVIEW_FIXTURES, 'utf8'));
  const deps = {
    workspacePath: () => FIXTURE_DIR,
    pullRequest: async () => ({ number: MAIN.prNumber, headRefOid: MAIN.headSha }),
    checkRuns: async () => MAIN.checkRuns,
    discussions: async () => MAIN.discussions,
    fixCommits: async () => MAIN.fixCommits,
    readState: async () => ({ ...GOLDEN, ...MAIN.state }),
    now: () => Date.parse('2026-11-02T18:00:00Z'),
  };

  afterEach(() => setDeftReviewCycleDepsForTests(null));

  it('returns 404 for a non-Deft issue', async () => {
    mocks.isDeftPipelineIssue.mockResolvedValue(false);
    expect((await call('GET', '/api/issues/PAN-1/deft/review-cycle')).status).toBe(404);
  });

  it('returns the derived review cycle', async () => {
    setDeftReviewCycleDepsForTests(deps);
    const res = await call('GET', '/api/issues/PAN-1/deft/review-cycle');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ verdict: 'NEW_P0_P1', prNumber: 12, errors: [] });
    expect(res.json.rounds).toHaveLength(2);
  });

  it('records a failing loader in errors and still answers 200', async () => {
    setDeftReviewCycleDepsForTests({ ...deps, discussions: async () => { throw new Error('rate limited'); } });
    const res = await call('GET', '/api/issues/PAN-1/deft/review-cycle');
    expect(res.status).toBe(200);
    expect(res.json.errors).toEqual(['discussions failed: rate limited']);
  });
});
