import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  createBeadsFromVBrief: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../lib/vbrief/beads.js', () => ({
  createBeadsFromVBrief: mocks.createBeadsFromVBrief,
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
  emitActivityTtsSync: mocks.emitActivityTtsSync,
}));

import { planFinalizeCommand } from '../../../../cli/commands/plan-finalize.js';
import { reconcileOrphanProposedSpecs } from '../../../../lib/cloister/orphan-proposed-reconciler.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';
import { completePlanningArtifacts, completePlanningAutoSpawn } from '../issues.js';

let testDir: string;
let oldDashboardUrl: string | undefined;

function makeDoc(issueId: string, status: VBriefDocument['plan']['status'] = 'draft'): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-25T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: `${issueId} auto promote regression`,
      status,
      items: [
        { id: 'item-1', title: 'Promote the spec', status: 'pending' },
        { id: 'item-2', title: 'Start the work agent', status: 'pending' },
      ],
      edges: [],
    },
  };
}

function makeProject(issueId: string): { projectPath: string; workspacePath: string } {
  const projectPath = join(testDir, 'project');
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(join(workspacePath, '.pan'), { recursive: true });
  writeFileSync(join(workspacePath, '.pan', 'spec.vbrief.json'), JSON.stringify(makeDoc(issueId), null, 2));
  return { projectPath, workspacePath };
}

function writeBeads(projectPath: string, issueId: string, count = 2): string[] {
  const beadsDir = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const beadIds = Array.from({ length: count }, (_, index) => `workspace-${issueId.toLowerCase()}-${index + 1}`);
  const lines = beadIds.map((id, index) => JSON.stringify({
    _type: 'issue',
    id,
    title: `${issueId} bead ${index + 1}`,
    labels: [issueId.toLowerCase()],
  }));
  writeFileSync(join(beadsDir, 'issues.jsonl'), `${lines.join('\n')}\n`);
  return beadIds;
}

function countIssueBeads(projectPath: string, issueId: string): number {
  const beadsPath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads', 'issues.jsonl');
  return readFileSync(beadsPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .filter((line) => JSON.parse(line).labels?.includes(issueId.toLowerCase()))
    .length;
}

function writeWorkAgentState(panopticonHome: string, issueId: string, status: 'starting' | 'running' = 'running'): string {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const stateDir = join(panopticonHome, 'agents', agentId);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    id: agentId,
    issueId,
    status,
    role: 'work',
  }, null, 2));
  return agentId;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'auto-promote-chain-'));
  oldDashboardUrl = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = 'http://dashboard.test';
  mocks.createBeadsFromVBrief.mockReset();
  mocks.emitActivityEntrySync.mockReset();
  mocks.emitActivityTtsSync.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (oldDashboardUrl === undefined) delete process.env.DASHBOARD_URL;
  else process.env.DASHBOARD_URL = oldDashboardUrl;
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('plan-finalize auto-promote chain regression', () => {
  it('finalizes planning, writes a proposed spec, materializes matching beads, and reports a running work agent', async () => {
    vi.useFakeTimers();
    const issueId = 'PAN-3401';
    const panopticonHome = join(testDir, 'panopticon-home');
    const tmuxSessions = new Set<string>();
    const { projectPath, workspacePath } = makeProject(issueId);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    mocks.createBeadsFromVBrief.mockImplementation((path: string) => Effect.succeed({
      success: true,
      created: writeBeads(projectPath, issueId).map((id) => `${id}: ${path}`),
      errors: [],
      beadIds: new Map(),
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`http://dashboard.test/api/issues/${issueId}/complete-planning`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ autoSpawn: true });

      const artifacts = await completePlanningArtifacts({
        projectPath,
        workspacePath,
        issueId,
        createBeads: async () => ({
          success: true,
          created: writeBeads(projectPath, issueId),
          errors: [],
          beadIds: new Map(),
        }),
      });

      const spawn = await completePlanningAutoSpawn({
        issueId,
        autoSpawn: true,
        dashboardOrigin: 'http://dashboard.test',
        fetchImpl: async (spawnInput, spawnInit) => {
          expect(String(spawnInput)).toBe('http://dashboard.test/api/agents');
          expect(JSON.parse(String(spawnInit?.body))).toEqual({ issueId, role: 'work' });
          const agentId = writeWorkAgentState(panopticonHome, issueId, 'running');
          tmuxSessions.add(agentId);
          return new Response(JSON.stringify({ success: true, agentId }), { status: 200 });
        },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Planning complete and work agent spawn requested',
        proposedSpec: artifacts.proposed.filename,
        beadCount: artifacts.beadCount,
        ...spawn,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await planFinalizeCommand({ workspace: workspacePath, json: true });

    const printed = JSON.parse(String(consoleLog.mock.calls.at(-1)?.[0] ?? '{}')) as Record<string, unknown>;
    const specFiles = readdirSync(join(projectPath, '.pan', 'specs'));
    const proposed = readJson<{ plan: { status: string; items: unknown[] } }>(join(projectPath, '.pan', 'specs', specFiles[0]));
    const agentStatePath = join(panopticonHome, 'agents', `agent-${issueId.toLowerCase()}`, 'state.json');
    const agentState = readJson<{ status: string }>(agentStatePath);

    expect(printed).toMatchObject({
      success: true,
      planStatus: 'proposed',
      promoted: true,
      workAgentSpawned: true,
      workAgentMessage: `Session: agent-${issueId.toLowerCase()}`,
    });
    expect(specFiles).toHaveLength(1);
    expect(proposed.plan.status).toBe('proposed');
    expect(countIssueBeads(projectPath, issueId)).toBe(proposed.plan.items.length);
    expect(agentState.status).toMatch(/^(starting|running)$/);
    expect(tmuxSessions.has(`agent-${issueId.toLowerCase()}`)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves no proposed spec on disk when bead materialization fails', async () => {
    const issueId = 'PAN-3402';
    const { projectPath, workspacePath } = makeProject(issueId);

    await expect(completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads: async () => ({
        success: false,
        created: [],
        errors: ['bd rejected malformed workspace database'],
        beadIds: new Map(),
      }),
    })).rejects.toThrow('bd rejected malformed workspace database');

    expect(existsSync(join(projectPath, '.pan', 'specs'))).toBe(false);
  });

  it('spawns a work agent when the reconciler finds a planted orphan proposed spec with matching beads', async () => {
    const issueId = 'PAN-3403';
    const panopticonHome = join(testDir, 'panopticon-home');
    const tmuxSessions = new Set<string>();
    const { projectPath } = makeProject(issueId);
    const specsDir = join(projectPath, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, `${issueId}.vbrief.json`), JSON.stringify(makeDoc(issueId, 'proposed'), null, 2));
    writeBeads(projectPath, issueId);

    await expect(reconcileOrphanProposedSpecs({
      projects: [{ key: 'panopticon', config: { name: 'Panopticon CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
      now: new Date('2026-05-25T20:30:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent: async (candidateIssueId) => {
        const agentId = writeWorkAgentState(panopticonHome, candidateIssueId, 'starting');
        tmuxSessions.add(agentId);
        return { spawned: true, agentId };
      },
    })).resolves.toEqual([`Spawned work agent for orphan proposed spec ${issueId}`]);

    const agentState = readJson<{ status: string }>(join(panopticonHome, 'agents', `agent-${issueId.toLowerCase()}`, 'state.json'));
    expect(agentState.status).toMatch(/^(starting|running)$/);
    expect(tmuxSessions.has(`agent-${issueId.toLowerCase()}`)).toBe(true);
  });

  it('returns a non-fatal stack-health skip when autoSpawn is rejected by the agents endpoint', async () => {
    const issueId = 'PAN-3404';
    const spawn = await completePlanningAutoSpawn({
      issueId,
      autoSpawn: true,
      dashboardOrigin: 'http://dashboard.test',
      fetchImpl: async () => new Response(JSON.stringify({
        success: false,
        skipped: true,
        error: `Workspace docker stack for ${issueId} is not healthy: api unhealthy`,
        stackHealth: { healthy: false, reasons: ['api unhealthy'] },
      }), { status: 422 }),
    });
    const completePlanningResponse = new Response(JSON.stringify({ success: true, ...spawn }), { status: 200 });
    const body = await completePlanningResponse.json() as Record<string, unknown>;

    expect(completePlanningResponse.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      workAgentSpawned: false,
      workAgentSkipReason: 'stack-unhealthy',
      workAgentError: `Workspace docker stack for ${issueId} is not healthy: api unhealthy`,
    });
  });
});
