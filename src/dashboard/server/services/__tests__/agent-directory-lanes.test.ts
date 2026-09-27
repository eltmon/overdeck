/**
 * PAN-4223 WI-11: lanes and successors in the Agents Directory. A lane or a
 * successor nests by its parent link; the live scope climbs a lane to its
 * launcher but never climbs a succession edge (D23).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetAgentDirectoryForTests,
  buildAgentDirectory,
  buildLiveAgentDirectory,
  type AgentDirectoryDeps,
  type DirectoryConversationRow,
} from '../agent-directory.js';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function conversation(overrides: Partial<DirectoryConversationRow> & { name: string }): DirectoryConversationRow {
  return {
    tmuxSession: `conv-${overrides.name}`,
    title: null,
    harness: 'claude-code',
    model: 'claude-opus-5',
    issueId: null,
    projectKey: null,
    cwd: '/home/op/Projects/lexerra',
    createdAt: iso(3_600_000),
    endedAt: null,
    lastActivityAt: iso(30_000),
    sessionAlive: true,
    isWorking: false,
    pendingInputCount: 0,
    totalCost: 1,
    ...overrides,
  };
}

function deps(rows: DirectoryConversationRow[]): AgentDirectoryDeps {
  return {
    now: () => NOW,
    listAgentStates: () => [],
    getBackendPanes: async () => [],
    listConversations: async () => rows,
    readRemoteState: async () => null,
    listConversationSubagents: async () => [],
    listAgentSubagents: async () => [],
    issueTitles: () => new Map(),
    listExternalEntries: async () => [],
    derivedIssueStates: () => new Map(),
    projectKeyForIssue: () => null,
    projectKeyForPath: () => 'lexerra',
  };
}

const ROOT = conversation({ name: 'orchestrator' });
const LANE = conversation({
  name: 'lane-663',
  parentConversationId: 10,
  parentConversationName: 'orchestrator',
  gauntletRun: 'hotel',
  laneKey: '663',
  laneRole: 'critic',
  laneIteration: 2,
  laneReport: { status: 'done' },
});
const SUCCESSOR = conversation({ name: 'successor', parentConversationId: 10, parentConversationName: 'orchestrator' });

beforeEach(() => {
  _resetAgentDirectoryForTests();
});

describe('agent directory lanes and successors (PAN-4223 WI-11)', () => {
  it('parents a lane and a successor by the parent link; a root keeps no parent', async () => {
    const { entries } = await buildAgentDirectory(24, deps([ROOT, LANE, SUCCESSOR]));
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId['conv:lane-663']).toMatchObject({
      parentId: 'conv:orchestrator',
      lane: { run: 'hotel', key: '663', role: 'critic', iteration: 2, reportStatus: 'done' },
    });
    expect(byId['conv:lane-663']?.continuesFrom).toBeUndefined();
    expect(byId['conv:successor']).toMatchObject({ parentId: 'conv:orchestrator', continuesFrom: 10 });
    expect(byId['conv:successor']?.lane).toBeUndefined();
    expect(byId['conv:orchestrator']?.parentId).toBeNull();
  });

  it('keeps a live successor without pulling its ended predecessor into the live scope', async () => {
    const ended = { ...ROOT, sessionAlive: false, endedAt: iso(600_000) };
    const { entries } = await buildLiveAgentDirectory(deps([ended, SUCCESSOR]));
    expect(entries.map((entry) => entry.id)).toEqual(['conv:successor']);
  });

  it('still pulls the ended launcher of a live lane into the live scope', async () => {
    const ended = { ...ROOT, sessionAlive: false, endedAt: iso(600_000) };
    const { entries } = await buildLiveAgentDirectory(deps([ended, LANE]));
    expect(entries.map((entry) => entry.id).sort()).toEqual(['conv:lane-663', 'conv:orchestrator']);
  });
});
