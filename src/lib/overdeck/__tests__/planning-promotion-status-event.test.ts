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
  saveAgentStateSync: vi.fn(),
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
  resolveAutoSpawnOnFinalize: async () => false,
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
  killSession: () => Effect.void,
  sessionExists: vi.fn(() => Effect.succeed(testState.sessionAlive)),
}));
vi.mock('../../xbrief/quality-lint.js', () => ({
  assertPlanQuality: vi.fn(),
  PlanQualityLintError: class PlanQualityLintError extends Error {},
}));
vi.mock('../issue-reads.js', () => ({
  resolveIssueProjectPathSync: () => testState.projectPath,
}));

import { getAgentStateSync, saveAgentStateSync } from '../../agents.js';
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
    request: {},
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
  it('appends agent.status_changed(stopped, hasLiveTmuxSession:true) when the skipKill session survives finalize', async () => {
    createWorkspace();
    testState.sessionAlive = true;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(200);
    expect(responseJson(response)).toMatchObject({ success: true, issueId: 'PAN-3230' });
    expect(getAgentStateSync).toHaveBeenCalledWith('planning-pan-3230');
    expect(saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'planning-pan-3230',
      status: 'stopped',
      stoppedAt: expect.any(String),
    }));
    expect(deps.eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.status_changed',
      payload: {
        agentId: 'planning-pan-3230',
        status: 'stopped',
        previousStatus: 'running',
        hasLiveTmuxSession: true,
      },
    }));
  });

  it('appends hasLiveTmuxSession:false when the planning session is already gone', async () => {
    createWorkspace();
    testState.sessionAlive = false;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(200);
    expect(deps.eventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.status_changed',
      payload: expect.objectContaining({ status: 'stopped', hasLiveTmuxSession: false }),
    }));
  });

  it('leaves the planning agent running and appends no stopped event when the PRD gate rejects the finalize', async () => {
    createWorkspace();
    testState.prdGateOk = false;
    const deps = serviceDependencies();

    const response = await completePlanningForIssue(deps);

    expect(response.status).toBe(422);
    expect(saveAgentStateSync).not.toHaveBeenCalled();
    expect(deps.eventStore.append).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.status_changed',
    }));
  });
});
