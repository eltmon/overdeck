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
let oldOverdeckDashboardUrl: string | undefined;
let oldOverdeckHome: string | undefined;

function makeDoc(issueId: string, status: VBriefDocument['plan']['status'] = 'draft'): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-25T00:00:00.000Z' },
    plan: {
      id: issueId,
      title: `${issueId} auto promote regression`,
      status,
      items: [
        {
          id: 'item-1',
          title: 'Promote the spec',
          status: 'pending',
          narrative: { Action: 'Promote the finalized workspace spec into the project specs directory' },
          metadata: {
            requiresInspection: false,
            files_scope: ['.pan/specs/*.vbrief.json'],
            files_scope_confidence: 'high',
            readiness: 'sequential',
            verify_commands: ['npm test -- src/dashboard/server/routes/__tests__/auto-promote-chain.integration.test.ts'],
          },
          subItems: [
            {
              id: 'item-1.ac1',
              title: 'The project specs directory stores the proposed vBRIEF',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
            {
              id: 'item-1.ac2',
              title: 'The promoted vBRIEF persists proposed status',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
          ],
        },
        {
          id: 'item-2',
          title: 'Start the work agent',
          status: 'pending',
          narrative: { Action: 'Start the work agent only when auto-start policy allows it' },
          metadata: {
            requiresInspection: false,
            files_scope: ['src/lib/agents.ts'],
            files_scope_confidence: 'high',
            readiness: 'sequential',
            verify_commands: ['npm test -- src/dashboard/server/routes/__tests__/auto-promote-chain.integration.test.ts'],
          },
          subItems: [
            {
              id: 'item-2.ac1',
              title: 'Default planning returns without spawning a work agent',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
            {
              id: 'item-2.ac2',
              title: 'Stamped planning spawns the work agent after promotion',
              status: 'pending',
              metadata: { kind: 'acceptance_criterion' },
            },
          ],
        },
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

function writeWorkAgentState(overdeckHome: string, issueId: string, status: 'starting' | 'running' = 'running'): string {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const stateDir = join(overdeckHome, 'agents', agentId);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    id: agentId,
    issueId,
    status,
    role: 'work',
  }, null, 2));
  return agentId;
}

function writePlanningAgentState(overdeckHome: string, issueId: string, autoSpawnOnFinalize: boolean): void {
  const agentId = `planning-${issueId.toLowerCase()}`;
  const stateDir = join(overdeckHome, 'agents', agentId);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
    id: agentId,
    issueId,
    status: 'running',
    role: 'plan',
    autoSpawnOnFinalize,
  }, null, 2));
  // planFinalizeCommand now reads autoSpawnOnFinalize from a flag file, not state.json
  // (refactor: replace state.json writes with saveAgentStateSync + flag file)
  if (autoSpawnOnFinalize) {
    writeFileSync(join(stateDir, 'auto-spawn-on-finalize.json'), JSON.stringify({ autoSpawnOnFinalize: true }, null, 2));
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'auto-promote-chain-'));
  oldDashboardUrl = process.env.DASHBOARD_URL;
  oldOverdeckDashboardUrl = process.env.OVERDECK_DASHBOARD_URL;
  oldOverdeckHome = process.env.OVERDECK_HOME;
  // OVERDECK_DASHBOARD_URL now wins over DASHBOARD_URL — clear it for determinism.
  delete process.env.OVERDECK_DASHBOARD_URL;
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
  if (oldOverdeckDashboardUrl === undefined) delete process.env.OVERDECK_DASHBOARD_URL;
  else process.env.OVERDECK_DASHBOARD_URL = oldOverdeckDashboardUrl;
  if (oldOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = oldOverdeckHome;
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('plan-finalize auto-promote chain regression', () => {
  it('finalizes planning, writes a proposed spec, materializes matching beads, and waits for manual start by default', async () => {
    vi.useFakeTimers();
    const issueId = 'PAN-3401';
    const overdeckHome = join(testDir, 'overdeck-home');
    process.env.OVERDECK_HOME = overdeckHome;
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
      expect(JSON.parse(String(init?.body))).toEqual({});

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
        autoSpawn: false,
        dashboardOrigin: 'http://dashboard.test',
        fetchImpl: async () => {
          throw new Error('work-agent spawn should not be requested');
        },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Planning complete and pushed to git - ready for execution',
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

    expect(printed).toMatchObject({
      success: true,
      planStatus: 'proposed',
      promoted: true,
      workAgentSpawned: false,
    });
    expect(specFiles).toHaveLength(1);
    expect(proposed.plan.status).toBe('proposed');
    expect(countIssueBeads(projectPath, issueId)).toBe(proposed.plan.items.length);
    expect(existsSync(join(overdeckHome, 'agents', `agent-${issueId.toLowerCase()}`, 'state.json'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const activityEvents = mocks.emitActivityEntrySync.mock.calls.map(([event]) => event);
    expect(activityEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'plan-finalize', message: 'auto-promote.phase=createBeads', issueId }),
      expect.objectContaining({ source: 'plan-finalize', message: 'auto-promote.phase=completePlanning', issueId }),
      expect.objectContaining({ source: 'plan-finalize', message: 'auto-promote.phase=terminal', issueId }),
      expect.objectContaining({ source: 'complete-planning', message: 'complete-planning.phase=beadsMaterialize', issueId }),
      expect.objectContaining({ source: 'complete-planning', message: 'complete-planning.phase=specWrite', issueId }),
      expect.objectContaining({ source: 'complete-planning', message: 'complete-planning.phase=autoSpawn', issueId }),
    ]));
  });

  it('auto-spawns a work agent when the planning state is stamped', async () => {
    vi.useFakeTimers();
    const issueId = 'PAN-3406';
    const overdeckHome = join(testDir, 'overdeck-home');
    process.env.OVERDECK_HOME = overdeckHome;
    writePlanningAgentState(overdeckHome, issueId, true);
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
          const agentId = writeWorkAgentState(overdeckHome, issueId, 'running');
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
    const agentStatePath = join(overdeckHome, 'agents', `agent-${issueId.toLowerCase()}`, 'state.json');
    const agentState = readJson<{ status: string }>(agentStatePath);

    expect(printed).toMatchObject({
      success: true,
      planStatus: 'proposed',
      promoted: true,
      workAgentSpawned: true,
      workAgentMessage: `Session: agent-${issueId.toLowerCase()}`,
    });
    expect(agentState.status).toMatch(/^(starting|running)$/);
    expect(tmuxSessions.has(`agent-${issueId.toLowerCase()}`)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ttsEvents = mocks.emitActivityTtsSync.mock.calls.map(([event]) => event);
    expect(ttsEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ utterance: `${issueId} planned, starting implementation` }),
    ]));
  });

  it('materializes beads from the workspace draft when an existing proposed spec is stale', async () => {
    const issueId = 'PAN-3405';
    const { projectPath, workspacePath } = makeProject(issueId);
    const specsDir = join(projectPath, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const staleDoc = makeDoc(issueId, 'proposed');
    staleDoc.plan.items = staleDoc.plan.items.slice(0, 1);
    const existingSpecPath = join(specsDir, `2026-05-25-${issueId}-stale.vbrief.json`);
    writeFileSync(existingSpecPath, JSON.stringify({ ...staleDoc, status: 'proposed' }, null, 2));

    const createBeads = vi.fn(async () => {
      const beadSource = readJson<VBriefDocument>(existingSpecPath);
      return {
        success: true,
        created: beadSource.plan.items.map((item) => item.title),
        errors: [],
        beadIds: new Map(),
      };
    });

    const artifacts = await completePlanningArtifacts({
      projectPath,
      workspacePath,
      issueId,
      createBeads,
    });

    expect(createBeads).toHaveBeenCalledWith(workspacePath);
    expect(artifacts.beadCount).toBe(2);
    const proposed = readJson<{ plan: { items: unknown[] } }>(existingSpecPath);
    expect(proposed.plan.items).toHaveLength(2);
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

    expect(existsSync(join(projectPath, '.pan', 'specs')) ? readdirSync(join(projectPath, '.pan', 'specs')) : []).toEqual([]);
  });

  it('spawns a work agent when the reconciler finds a planted orphan proposed spec with matching beads', async () => {
    const issueId = 'PAN-3403';
    const overdeckHome = join(testDir, 'overdeck-home');
    const tmuxSessions = new Set<string>();
    const { projectPath } = makeProject(issueId);
    const specsDir = join(projectPath, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, `${issueId}.vbrief.json`), JSON.stringify(makeDoc(issueId, 'proposed'), null, 2));
    writeBeads(projectPath, issueId);

    await expect(reconcileOrphanProposedSpecs({
      projects: [{ key: 'overdeck', config: { name: 'Overdeck CLI', path: projectPath } }],
      tmuxSessionNames: [],
      getAgentStateForIssue: async () => null,
      closedIssueIds: new Set(),
      now: new Date('2026-05-25T20:30:00.000Z'),
      config: { enabled: true, minAttemptIntervalMs: 5 * 60 * 1000 },
      spawnWorkAgent: async (candidateIssueId) => {
        const agentId = writeWorkAgentState(overdeckHome, candidateIssueId, 'starting');
        tmuxSessions.add(agentId);
        return { spawned: true, agentId };
      },
    })).resolves.toEqual([`Spawned work agent for orphan proposed spec ${issueId}`]);

    const agentState = readJson<{ status: string }>(join(overdeckHome, 'agents', `agent-${issueId.toLowerCase()}`, 'state.json'));
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
