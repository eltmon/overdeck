/**
 * PAN-4223 WI-23: a critic lane's directory entry nests under the builder it
 * judges and carries its verdict; a builder carries its latest critic verdict.
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
    endedAt: iso(600_000),
    lastActivityAt: iso(600_000),
    sessionAlive: false,
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

const lanes = { parentConversationId: 1, parentConversationName: 'root', gauntletRun: 'hotel', laneKey: '663', laneIteration: 1 };
const ROOT = conversation({ name: 'root' });
const BUILDER = conversation({ name: 'builder', ...lanes, laneRole: 'builder', laneLatestVerdict: { value: 'NOT_YET' } });
const CRITIC = conversation({
  name: 'critic', ...lanes, laneRole: 'critic', criticOfConversationId: 2, criticOfConversationName: 'builder', laneVerdict: { value: 'NOT_YET' },
});

beforeEach(() => _resetAgentDirectoryForTests());

describe('agent directory critic link (PAN-4223 WI-23)', () => {
  it('parents a critic by its builder and carries the verdicts', async () => {
    const { entries } = await buildAgentDirectory(24, deps([ROOT, BUILDER, CRITIC]));
    const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    expect(byId['conv:critic']).toMatchObject({ parentId: 'conv:builder', lane: { role: 'critic', verdict: 'NOT_YET', criticOf: 2 } });
    expect(byId['conv:builder']).toMatchObject({ parentId: 'conv:root', lane: { role: 'builder', verdict: 'NOT_YET' } });
    expect(byId['conv:builder']?.lane?.criticOf).toBeUndefined();
  });

  it('keeps the builder and the root in the live scope when only the critic is live', async () => {
    const live = { ...CRITIC, sessionAlive: true, endedAt: null, lastActivityAt: iso(1_000) };
    const { entries } = await buildLiveAgentDirectory(deps([ROOT, BUILDER, live]));
    expect(entries.map((entry) => entry.id).sort()).toEqual(['conv:builder', 'conv:critic', 'conv:root']);
  });
});
