import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ projectPath: '' }));

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
  getAgentStateSync: () => null,
  saveAgentStateSync: vi.fn(),
}));
vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));
vi.mock('../../pan-dir/index.js', () => ({
  WORKSPACE_RUNTIME_DIRNAME: '.overdeck',
  asPanSpecDocument: (doc: Record<string, unknown>) => doc,
  checkPrdGateSync: vi.fn(),
  findSpecByIssue: () => Effect.succeed(null),
  promoteWorkspacePrdDraft: () => Effect.succeed({ promoted: false, reason: 'no draft' }),
  writeSpecDocument: () => Effect.void,
  writeSpecForIssue: () => Effect.succeed({
    path: '/state/specs/2026-07-28-PAN-3229-test.xbrief.json',
    filename: '2026-07-28-PAN-3229-test.xbrief.json',
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
  resolveGitHubIssueSync: () => ({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 3229 }),
}));
vi.mock('../../tmux.js', () => ({
  killSession: () => Effect.void,
  sessionExists: () => Effect.succeed(false),
}));
vi.mock('../../xbrief/quality-lint.js', () => ({
  assertPlanQuality: vi.fn(),
  PlanQualityLintError: class PlanQualityLintError extends Error {},
}));
vi.mock('../issue-reads.js', () => ({
  resolveIssueProjectPathSync: () => testState.projectPath,
}));

import { completePlanningForIssue } from '../planning-promotion.js';

const roots: string[] = [];

function createWorkspace(withMarker: boolean): { workspacePath: string; markerPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'planning-promotion-marker-cleanup-'));
  roots.push(root);
  testState.projectPath = root;
  const workspacePath = join(root, 'workspaces', 'feature-pan-3229');
  const runtimeDir = join(workspacePath, '.overdeck');
  const markerPath = join(runtimeDir, 'pending-promotion.json');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'spec.vbrief.json'), JSON.stringify({
    xBRIEFInfo: {
      version: '0.8',
      created: '2026-07-28T17:00:00.000Z',
      author: 'test',
      description: 'Promotion cleanup service test',
    },
    plan: {
      id: 'pan-3229',
      title: 'Promotion cleanup service test',
      status: 'proposed',
      sequence: 0,
      created: '2026-07-28T17:00:00.000Z',
      updated: '2026-07-28T17:00:00.000Z',
      items: [{
        id: 'cleanup',
        title: 'Clean up marker',
        status: 'pending',
        metadata: {
          files_scope: ['src/lib/overdeck/planning-promotion.ts'],
          files_scope_confidence: 'high',
          readiness: 'ready',
          verify_commands: ['npm test'],
          expected_outputs: ['marker removed'],
        },
      }],
      edges: [],
    },
  }, null, 2));
  if (withMarker) writeFileSync(markerPath, '{"version":"1"}\n');
  return { workspacePath, markerPath };
}

function responseJson(response: { body: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function serviceDependencies() {
  return {
    request: {},
    id: 'PAN-3229',
    body: { noPrd: true, skipKill: true, autoSpawn: false },
    eventStore: { append: vi.fn(() => Effect.void) },
    linear: {},
    lifecycle: {
      removeLabel: vi.fn(() => Effect.void),
      addLabel: vi.fn(() => Effect.void),
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('planning promotion marker cleanup', () => {
  it('removes a pending-promotion marker before the success response returns', async () => {
    const { markerPath } = createWorkspace(true);

    const response = await completePlanningForIssue(serviceDependencies());

    expect(response.status).toBe(200);
    expect(responseJson(response)).toMatchObject({ success: true, issueId: 'PAN-3229' });
    expect(existsSync(markerPath)).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Removed pending-promotion marker'));
  });

  it('returns success when no marker exists without logging a removal', async () => {
    const { markerPath } = createWorkspace(false);

    const response = await completePlanningForIssue(serviceDependencies());

    expect(response.status).toBe(200);
    expect(responseJson(response)).toMatchObject({ success: true, issueId: 'PAN-3229' });
    expect(existsSync(markerPath)).toBe(false);
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Removed pending-promotion marker'));
  });
});
