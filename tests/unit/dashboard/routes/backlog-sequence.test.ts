/**
 * GET /api/backlog/sequence (PAN-3969).
 *
 * The route used to derive the full FR-6 state for every sequence node —
 * one serial git spawn per issue without a PR (~800 for an 850-node backlog,
 * 11–21 s per request) — for a `pipelineState` field no frontend code reads.
 * `inPipeline` now comes from the shared classifier's workspace-exists
 * lookup, the same oracle the forecast route uses. These tests pin that
 * contract: the handler never calls `loadIssueStatesForProject`, never spawns
 * git, and reports `inPipeline` true exactly when the workspace directory
 * exists.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadIssueStatesForProject: vi.fn(),
  execFile: vi.fn(),
}));

// Tripwire: the route must not derive per-issue FR-6 state. If the import and
// the call ever come back, this mock intercepts it and the assertions fail.
vi.mock('../../../../src/dashboard/server/services/derived-issue-state.js', () => ({
  loadIssueStatesForProject: mocks.loadIssueStatesForProject,
}));

vi.mock('../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ getIssues: () => [] }),
}));

// Side-effect-heavy route deps the GET sequence path never touches.
vi.mock('../../../../src/lib/backlog/sequencer-agent.js', () => ({
  SEQUENCER_AGENT_ID: 'sequencer-runner',
  getSequencerRunStatus: vi.fn(),
  spawnSequencerAgent: vi.fn(),
}));
vi.mock('../../../../src/dashboard/server/routes/jsonl-resolver.js', () => ({
  resolvePiSessionPath: vi.fn(),
}));
vi.mock('../../../../src/lib/backlog/label-ops.js', () => ({
  applyIssueVetoedLabel: vi.fn(), removeIssueVetoedLabel: vi.fn(),
  applyIssueReadyLabel: vi.fn(), removeIssueReadyLabel: vi.fn(),
  applyIssueParkedLabel: vi.fn(), removeIssueParkedLabel: vi.fn(),
  applyIssueBlocksMainLabel: vi.fn(), removeIssueBlocksMainLabel: vi.fn(),
  applyIssueReleasedLabel: vi.fn(), removeIssueReleasedLabel: vi.fn(),
  applyIssueObjectionLabel: vi.fn(), removeIssueObjectionLabel: vi.fn(),
}));
vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  isFlywheelAutoPickupBacklog: () => false,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mocks.execFile,
}));

import { backlogRouteLayer } from '../../../../src/dashboard/server/routes/backlog.js';

function node(issue: string, rank: number): Record<string, unknown> {
  return {
    issue, rank, size: 'S', importance: 'high', score: 50, condition: 'ok',
    dependsOn: [], why: `rank ${rank}`, gate: 'auto', planning: 'auto',
  };
}

function writeSequence(root: string, issues: string[]): void {
  const dir = join(root, '.pan', 'backlog');
  mkdirSync(dir, { recursive: true });
  const doc = {
    version: 1,
    project: 'test',
    generatedAt: '2026-09-20T00:00:00Z',
    model: 'test',
    pass: 'creation',
    openCount: issues.length,
    nodes: issues.map((issue, i) => node(issue, i + 1)),
    edges: [],
  };
  writeFileSync(
    join(dir, 'sequence.md'),
    `# Backlog sequence\n\n<!-- machine-readable; do not hand-edit below this line -->\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`,
    'utf8',
  );
}

async function requestSequence(): Promise<{ status: number; body: { nodes: Array<Record<string, unknown>> } }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/backlog/sequence'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(backlogRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('GET /api/backlog/sequence', () => {
  let projectRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'backlog-sequence-route-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    mocks.loadIssueStatesForProject.mockReset();
    mocks.execFile.mockReset();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('marks inPipeline exactly when the issue workspace exists on disk', async () => {
    writeSequence(projectRoot, ['PAN-1', 'PAN-2', 'PAN-3']);
    mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-2'), { recursive: true });

    const { status, body } = await requestSequence();

    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(3);
    const byIssue = new Map(body.nodes.map((n) => [n['issueId'], n]));
    expect(byIssue.get('PAN-1')?.['inPipeline']).toBe(false);
    expect(byIssue.get('PAN-2')?.['inPipeline']).toBe(true);
    expect(byIssue.get('PAN-3')?.['inPipeline']).toBe(false);
  });

  it('emits no pipelineState field and never derives per-issue state', async () => {
    writeSequence(projectRoot, ['PAN-1', 'PAN-2']);

    const { status, body } = await requestSequence();

    expect(status).toBe(200);
    for (const n of body.nodes) {
      expect(n).not.toHaveProperty('pipelineState');
    }
    expect(mocks.loadIssueStatesForProject).not.toHaveBeenCalled();
    const gitCalls = mocks.execFile.mock.calls.filter((call) => call[0] === 'git');
    expect(gitCalls).toEqual([]);
  });
});
