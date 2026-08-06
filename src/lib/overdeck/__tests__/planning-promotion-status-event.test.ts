import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3338: completePlanningForIssue must emit agent.status_changed(stopped)
// into the event store after a successful finalize, and must NOT do so when
// the PRD-first gate rejects the finalize. Mirrors the mocking harness in
// planning-promotion-marker-cleanup.test.ts, which is the established pattern
// for exercising completePlanningForIssue end to end.
const testState = vi.hoisted(() => ({
  projectPath: '',
  agentState: null as null | Record<string, unknown>,
  sessionAlive: false,
  prdGateOk: true,
}));

vi.mock('../../../dashboard/server/routes/agents.js', () => ({
  invalidateAgentsCache: vi.fn(),
}));
vi.mock('../../../dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ patchIssue: vi.fn() }),
}));
vi.mock('../../../dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: () => null,
}));
vi.mock('../../agent-enrichment.js', () => ({
  countPendingAskUserQuestionsForAgent: () => Effect.succeed(0),
}));
vi.mock('../../agents.js', () => ({
  getAgentStateSync: vi.fn(() => testState.agentState),
}));
vi.mock('../../../dashboard/server/services/agent-projection.js', () => ({
  saveAgentStateAndEmitEvent: vi.fn(),
}));
vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));
vi.mock('../../pan-dir/index.js', () => ({
  WORKSPACE_RUNTIME_DIRNAME: '.overdeck',
  asPanSpecDocument: (doc: Record<string, unknown>) => doc,
  checkPrdGateSync: vi.fn(() => (testState.prdGateOk
    ? { ok: true, path: '/workspace/.overdeck/drafts/test.md', lineCount: 42 }
    : { ok: false, reason: 'missing' })),
  findSpecByIssue: () => Effect.succeed(null),
  promoteWorkspacePrdDraft: () => Effect.succeed({ promoted: false, reason: 'no draft' }),
  writeSpecDocument: () => Effect.void,
  writeSpecForIssue: () => Effect.succeed({
    path: '/state/specs/2026-08-01-PAN-3230-test.xbrief.json',
    filename: '2026-08-01-PAN-3230-test.xbrief.json',
  }),
}));
vi.mock('../../planning/spawn-planning-session.js', () => ({
  resolveAutoSpawnOnFinalize: async (requested: unknown) => requested === true,
}));
vi.mock('../../projects.js', () => ({
  extractTeamPrefix: () => 'PAN',
  findProjectByPathSync: () => null,
  findProjectByTeamSync: () => null,
  resolveProjectFromIssueSync: () => null,
}));
vi.mock('../../remote/remote-agents.js', () => ({
  loadRemoteAgentState: () => null,
}));
vi.mock('../../tracker-utils.js', () => ({
  resolveGitHubIssueSync: () => ({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 3230 }),
}));
vi.mock('../../tmux.js', () => ({
  // Killing the session actually clears sessionAlive so the follow-up
  // sessionExists() read (immediate or deferred) observes the true post-kill
  // state, exercising the PAN-3338 correctness fix under test below.
  killSession: vi.fn(() => { testState.sessionAlive = false; return Effect.void; }),
  sessionExists: vi.fn(() => Effect.succeed(testState.sessionAlive)),
}));
vi.mock('../../xbrief/quality-lint.js', () => ({
  assertPlanQuality: vi.fn(),
  PlanQualityLintError: class PlanQualityLintError extends Error {},
}));
vi.mock('../issue-reads.js', () => ({
  resolveIssueProjectPathSync: () => testState.projectPath,
}));

import { getAgentStateSync } from '../../agents.js';
import { saveAgentStateAndEmitEvent } from '../../../dashboard/server/services/agent-projection.js';
import { completePlanningForIssue } from '../planning-promotion.js';

const roots: string[] = [];

function createWorkspace(): { workspacePath: string } {
  const root = mkdtempSync(join(tmpdir(), 'planning-promotion-status-event-'));
  roots.push(root);
  testState.projectPath = root;
  const workspacePath = join(root, 'workspaces', 'feature-pan-3230');
  const runtimeDir = join(workspacePath, '.overdeck');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'spec.vbrief.json'), JSON.stringify({
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-08-01T00:00:00.000Z',
      author: 'test',
      description: 'Status event test',
    },
    plan: {
      id: 'pan-3230',
      title: 'Status event test',
      status: 'proposed',
      sequence: 0,
      created: '2026-08-01T00:00:00.000Z',
      updated: '2026-08-01T00:00:00.000Z',
      items: [{
        id: 'item-1',
        title: 'An item',
        status: 'pending',
        metadata: {
          files_scope: ['src/lib/overdeck/planning-promotion.ts'],
          files_scope_confidence: 'high',
          readiness: 'ready',
          verify_commands: ['npm test'],
          expected_outputs: ['ok'],
        },
      }],
      edges: [],
    },
  }, null, 2));
  return { workspacePath };
}

function responseJson(response: { body: unknown; status: number }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function serviceDependencies() {
  return {
    // bodyAutoSpawn:true routes through validateOrigin(), which reads
    // headers/method off this object — give it a minimal trusted shape.
    request: { headers: { origin: 'http://127.0.0.1:3011' }, method: 'POST' },
    id: 'PAN-3230',
    body: { noPrd: false, skipKill: true, autoSpawn: false },
    eventStore: { append: vi.fn(() => Effect.void) },
    linear: {},
    lifecycle: {
      removeLabel: vi.fn(() => Effect.void),
      addLabel: vi.fn(() => Effect.void),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  testState.agentState = {
    id: 'planning-pan-3230',
    issueId: 'PAN-3230',
    workspace: '/tmp/planning-pan-3230',
    role: 'plan',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-08-01T00:00:00.000Z',
  };
  testState.sessionAlive = false;
  testState.prdGateOk = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('completePlanningForIssue status event (PAN-3338)', () => {
  it('routes the stopped projection through the atomic write door with hasLiveTmuxSession:true when the skipKill session survives finalize', async () => {
    createWorkspace();
    testState.sessionAlive = true;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(200);
    expect(responseJson(response)).toMatchObject({ success: true, issueId: 'PAN-3230' });
    expect(getAgentStateSync).toHaveBeenCalledWith('planning-pan-3230');
    expect(saveAgentStateAndEmitEvent).toHaveBeenCalledTimes(1);
    expect(saveAgentStateAndEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'planning-pan-3230', status: 'stopped', stoppedAt: expect.any(String) }),
      expect.objectContaining({
        type: 'agent.status_changed',
        payload: {
          agentId: 'planning-pan-3230',
          status: 'stopped',
          previousStatus: 'running',
          hasLiveTmuxSession: true,
        },
      }),
    );
    // No separate row write exists any more — the atomic door is the only
    // status-mutating call, so a failure in it can never leave a split state.
    expect(deps.eventStore.append).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.status_changed' }));
  });

  it('appends hasLiveTmuxSession:false when the planning session is already gone', async () => {
    createWorkspace();
    testState.sessionAlive = false;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(200);
    expect(saveAgentStateAndEmitEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent.status_changed',
        payload: expect.objectContaining({ status: 'stopped', hasLiveTmuxSession: false }),
      }),
    );
  });

  it('leaves the planning agent running and appends no stopped event when the PRD gate rejects the finalize', async () => {
    createWorkspace();
    testState.prdGateOk = false;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(422);
    expect(saveAgentStateAndEmitEvent).not.toHaveBeenCalled();
  });

  /**
   * [correctness] review finding — sampling sessionExists() before the
   * auto-spawn/kill decision recorded a pre-kill snapshot that went stale the
   * instant the immediate-kill path (autoSpawn:true, skipKill:false) actually
   * killed the session, and nothing ever corrected it (the enrichment poller
   * only processes tmux-active agents). The projection must run AFTER the
   * kill has already been awaited.
   */
  it('the immediate-kill path (autoSpawn:true) records hasLiveTmuxSession:false, not the pre-kill snapshot', async () => {
    createWorkspace();
    testState.sessionAlive = true;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, agentId: 'agent-pan-3230' }), { status: 200 })) as unknown as typeof fetch;
    try {
      const deps = serviceDependencies();
      deps.body = { noPrd: false, skipKill: false, autoSpawn: true };

      const response = await completePlanningForIssue(deps);

      expect(response.status).toBe(200);
      expect(saveAgentStateAndEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'stopped' }),
        expect.objectContaining({
          type: 'agent.status_changed',
          payload: expect.objectContaining({ status: 'stopped', hasLiveTmuxSession: false }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  /**
   * [correctness] review finding — the deferred-kill path (autoSpawn:false,
   * skipKill:false) kills the session 1.5s after the HTTP response, outside
   * the request lifecycle entirely. The first projection truthfully reports
   * the session as still alive at that moment; a second corrective
   * projection must fire once the deferred kill actually runs, or the read
   * model is stuck at hasLiveTmuxSession:true forever.
   */
  it('the deferred-kill path (autoSpawn:false, skipKill:false) corrects hasLiveTmuxSession once the scheduled kill runs', async () => {
    vi.useFakeTimers();
    try {
      createWorkspace();
      testState.sessionAlive = true;
      const deps = serviceDependencies();
      deps.body = { noPrd: false, skipKill: false, autoSpawn: false };

      const response = await completePlanningForIssue(deps);
      expect(response.status).toBe(200);

      expect(saveAgentStateAndEmitEvent).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ payload: expect.objectContaining({ hasLiveTmuxSession: true }) }),
      );

      await vi.advanceTimersByTimeAsync(1500);

      expect(saveAgentStateAndEmitEvent).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ payload: expect.objectContaining({ hasLiveTmuxSession: false }) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * [requirements] review finding — the previous split write (row write, then
   * a SEPARATE eventStore.append) let a transient failure leave the
   * agents-table row stopped with no matching event: the exact DB/read-model
   * divergence this issue exists to fix. Routing through the transactional
   * write door means a failure here touches neither the row nor the event —
   * this test proves the failure is swallowed non-fatally and there is no
   * fallback path that would perform a partial write.
   */
  it('a write-door failure is non-fatal to finalize and has no fallback split-write path', async () => {
    createWorkspace();
    testState.sessionAlive = true;
    vi.mocked(saveAgentStateAndEmitEvent).mockImplementationOnce(() => {
      throw new Error('simulated transactional failure');
    });
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(200);
    expect(saveAgentStateAndEmitEvent).toHaveBeenCalledTimes(1);
  });
});
