/**
 * PAN-4638 WI-3: the lane work doors launch a lane in this machine's own
 * project for the caller's repository, and read or reap only lanes the
 * caller's environment started here.
 */
import { describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import type { OwnerLaneSpec } from '../../../lib/lanes/owner-launch.js';
import { LaneLaunchError } from '../../../lib/lanes/types.js';
import type { LaneView } from '../../../lib/lanes/views.js';
import type { LegacyConversation } from '../../../lib/overdeck/conversations.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { readJsonResponse } from '../routes/machines-work.js';
import {
  handleWorkLaneLaunch,
  handleWorkLaneReap,
  handleWorkLaneStatus,
  type LaneDoorDeps,
} from '../routes/machines-work-lanes.js';

const machineOf = (environmentId: string, actor: 'operator' | { agentId: string } = { agentId: 'agent-pan-7' }): DashboardCredential => ({
  kind: 'machine', tokenId: 't', environmentId, scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator',
});
const DEVICE = { kind: 'device', tokenId: 'd', scopes: [] } as unknown as DashboardCredential;

const SPEC: OwnerLaneSpec = {
  name: '20261101-1234',
  run: 'hotel',
  key: '663',
  role: 'builder',
  iteration: 1,
  brief: '# Build',
  briefHeader: '<!-- lane hotel/663 builder i1; parent orch; source inline -->',
  title: 'hotel 663 · builder',
  model: 'claude-opus-5-5',
  harness: 'claude-code',
  effort: null,
  branch: 'hotel/663',
  base: null,
  at: null,
  reuseCwd: null,
  answering: null,
  force: false,
};

function laneRow(name: string): LegacyConversation {
  return { name, gauntletRun: 'hotel', laneKey: '663', laneRole: 'builder', spawnError: null } as unknown as LegacyConversation;
}

function view(activity: LaneView['activity'] = 'working'): LaneView {
  return {
    activity,
    lastActivityAt: '2026-11-01T10:00:00.000Z',
    archived: false,
    git: { branch: 'hotel/663', head: 'abc1234', ahead: 1, dirty: false },
    costUsd: 1.5,
    cwd: '/home/u/lanes/hotel-663',
  } as unknown as LaneView;
}

function report(seq: number): WorkerReport {
  return { seq, at: `2026-11-01T10:00:0${seq % 10}.000Z`, status: 'done', body: `report ${seq}` };
}

function deps(overrides: Partial<LaneDoorDeps> = {}) {
  const startedBy: Record<string, string> = { '20261101-0001': 'env-laptop' };
  const value: LaneDoorDeps = {
    listProjects: async () => [
      { key: 'lex-owner', config: { name: 'Lexerra', path: '/srv/lexerra', github_repo: 'eltmon/lexerra' } as ProjectConfig },
    ],
    thisLabel: async () => 'desk',
    launch: vi.fn(async (spec: OwnerLaneSpec) => ({ name: spec.name, cwd: `/home/u/lanes/${spec.run}-${spec.key}`, branch: spec.branch, warnings: [] })),
    laneRow: (name) => (startedBy[name] || name === '20261101-0002' ? laneRow(name) : null),
    startedBy: (name) => startedBy[name] ?? null,
    laneView: vi.fn(async () => view()),
    listReports: vi.fn(async () => [report(3), report(1), report(2)]),
    lastAssistantMessage: vi.fn(async () => 'finished the map'),
    reap: vi.fn(async () => ({ removed: true as const, archived: true, parkedPatch: null, warnings: [] })),
    ...overrides,
  };
  return value;
}

describe('POST /api/machines/work/lanes (PAN-4638 WI-3)', () => {
  it('ac1: a device credential gets 403 machine-only', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkLaneLaunch(DEVICE, { ...SPEC, gitOrigin: 'github.com/eltmon/lexerra' }, d));
    expect(response).toMatchObject({ status: 403, body: { code: 'machine-only' } });
    expect(d.launch).not.toHaveBeenCalled();
  });

  it('ac2: launches in the local project registered under another key, ignoring a home project key', async () => {
    for (const actor of ['operator', { agentId: 'agent-pan-7' }] as const) {
      const d = deps();
      const response = readJsonResponse(await handleWorkLaneLaunch(
        machineOf('env-laptop', actor),
        { ...SPEC, gitOrigin: 'github.com/Eltmon/Lexerra', projectKey: 'lexerra-home' },
        d,
      ));
      expect(response).toMatchObject({ status: 201, body: { name: SPEC.name, branch: 'hotel/663' } });
      expect(d.launch).toHaveBeenCalledWith(SPEC, { projectKey: 'lex-owner', startedBy: 'env-laptop' });
    }
  });

  it('ac2: answers 404 project-missing when no local project has the origin', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkLaneLaunch(machineOf('env-laptop'), { ...SPEC, gitOrigin: 'github.com/x/y' }, d));
    expect(response).toMatchObject({ status: 404, body: { code: 'project-missing', machine: 'desk' } });
    expect(d.launch).not.toHaveBeenCalled();
  });

  it('maps a launch refusal to its status and code', async () => {
    const d = deps({ launch: vi.fn(async () => { throw new LaneLaunchError(409, 'name-taken: conversation x exists', 'name-taken'); }) });
    const response = readJsonResponse(await handleWorkLaneLaunch(machineOf('env-laptop'), { ...SPEC, gitOrigin: 'github.com/eltmon/lexerra' }, d));
    expect(response).toEqual({ status: 409, body: { error: 'name-taken: conversation x exists', code: 'name-taken' } });
  });

  it('answers 400 for a malformed body', async () => {
    const d = deps();
    expect(readJsonResponse(await handleWorkLaneLaunch(machineOf('env-laptop'), { ...SPEC }, d)).status).toBe(400);
    expect(readJsonResponse(await handleWorkLaneLaunch(machineOf('env-laptop'), { ...SPEC, gitOrigin: 'github.com/eltmon/lexerra', iteration: '1' }, d)).status).toBe(400);
    expect(readJsonResponse(await handleWorkLaneLaunch(machineOf('env-laptop'), { ...SPEC, gitOrigin: 'github.com/eltmon/lexerra', answering: { verdict: 1 } }, d)).status).toBe(400);
  });
});

describe('lane status and reap doors (PAN-4638 WI-3)', () => {
  it('ac3: another environment, or a lane started here, gets 404 unknown-lane from status and reap', async () => {
    const d = deps();
    for (const name of ['20261101-0001', '20261101-0002', '20261101-0003']) {
      const caller = machineOf(name === '20261101-0001' ? 'env-desk' : 'env-laptop');
      expect(readJsonResponse(await handleWorkLaneStatus(caller, name, 0, d))).toMatchObject({ status: 404, body: { code: 'unknown-lane' } });
      expect(readJsonResponse(await handleWorkLaneReap(caller, name, {}, d))).toMatchObject({ status: 404, body: { code: 'unknown-lane' } });
    }
    expect(d.reap).not.toHaveBeenCalled();
  });

  it('ac4: returns the reports after `after`, oldest first, and no last message while working', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkLaneStatus(machineOf('env-laptop'), '20261101-0001', 1, d));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      activity: 'working',
      archived: false,
      git: { head: 'abc1234' },
      costUsd: 1.5,
      cwd: '/home/u/lanes/hotel-663',
      spawnError: null,
      lastAssistantMessage: null,
    });
    expect((response.body as { reports: WorkerReport[] }).reports.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(d.listReports).toHaveBeenCalledWith('conv-20261101-0001');
    expect(d.lastAssistantMessage).not.toHaveBeenCalled();
  });

  it('caps reports at 20 and sends the last assistant message while idle', async () => {
    const d = deps({
      laneView: vi.fn(async () => view('idle')),
      listReports: vi.fn(async () => Array.from({ length: 25 }, (_, index) => report(index + 1))),
    });
    const body = readJsonResponse(await handleWorkLaneStatus(machineOf('env-laptop'), '20261101-0001', 0, d)).body as {
      reports: WorkerReport[];
      lastAssistantMessage: string | null;
    };
    expect(body.reports.map((entry) => entry.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(body.lastAssistantMessage).toBe('finished the map');
  });

  it('reaps a lane the caller started, passing park and keep', async () => {
    const d = deps();
    const response = readJsonResponse(await handleWorkLaneReap(machineOf('env-laptop'), '20261101-0001', { park: true }, d));
    expect(response).toMatchObject({ status: 200, body: { removed: true, archived: true } });
    expect(d.reap).toHaveBeenCalledWith('20261101-0001', { park: true, keep: false });
    expect(readJsonResponse(await handleWorkLaneReap(machineOf('env-laptop'), '20261101-0001', { keep: 'yes' }, d)).status).toBe(400);
  });
});
