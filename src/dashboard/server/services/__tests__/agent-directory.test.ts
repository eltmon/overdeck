/**
 * PAN-3920 W3 — the Agents Directory read model. Every source is injected;
 * nothing touches ~/.overdeck, tmux, Herdr or overdeck.db.
 */
import type { BackendPane } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../../../lib/agents/agent-state-read.js';
import {
  _resetAgentDirectoryForTests,
  buildAgentDirectory,
  getAgentDirectory,
  type AgentDirectoryDeps,
  type DirectoryConversationRow,
} from '../agent-directory.js';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 3_600_000;

function agent(overrides: Partial<AgentState> & { id: string }): AgentState {
  return {
    issueId: 'PAN-1',
    workspace: '/home/op/Projects/overdeck/workspaces/feature-pan-1',
    role: 'work',
    model: 'claude-opus-5',
    harness: 'claude-code',
    status: 'running',
    startedAt: iso(2 * HOUR),
    lastActivity: iso(60_000),
    ...overrides,
  } as AgentState;
}

function pane(overrides: Partial<BackendPane> & { id: string }): BackendPane {
  return { role: 'work', harness: 'claude-code', model: 'claude-opus-5', state: 'working', stateSince: NOW - 60_000, ...overrides };
}

function conversation(overrides: Partial<DirectoryConversationRow> & { name: string }): DirectoryConversationRow {
  return {
    tmuxSession: `conv-${overrides.name}`,
    title: null,
    harness: 'claude-code',
    model: 'claude-opus-5',
    issueId: null,
    projectKey: null,
    cwd: '/home/op/Projects/overdeck',
    createdAt: iso(3 * HOUR),
    endedAt: null,
    lastActivityAt: iso(30_000),
    sessionAlive: true,
    isWorking: false,
    pendingInputCount: 0,
    totalCost: 1.5,
    ...overrides,
  };
}

function deps(overrides: AgentDirectoryDeps = {}): AgentDirectoryDeps {
  return {
    now: () => NOW,
    listAgentStates: () => [],
    getBackendPanes: async () => [],
    listConversations: async () => [],
    readRemoteLocation: async () => null,
    listConversationSubagents: async () => [],
    listAgentSubagents: async () => [],
    projectKeyForIssue: (issueId) => (issueId.startsWith('PAN-') ? 'overdeck' : null),
    projectKeyForPath: (path) => (path.startsWith('/home/op/Projects/overdeck') ? 'overdeck' : null),
    ...overrides,
  };
}

beforeEach(() => {
  _resetAgentDirectoryForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildAgentDirectory', () => {
  it('joins a Herdr pane to its agent by agentId, not by pane id', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-1' })],
      getBackendPanes: async () => [pane({ id: 'w1:p1', agentId: 'agent-pan-1', issue: 'PAN-1', state: 'working' })],
    }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'agent-pan-1',
      kind: 'agent',
      state: 'working',
      label: 'work · PAN-1',
      source: 'overdeck',
      projectKey: 'overdeck',
      transcript: { route: 'agent', agentId: 'agent-pan-1' },
    });
  });

  it('reports an agent without a pane as stopped and drops it outside the window', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-1', lastActivity: iso(2 * HOUR) }),
        agent({ id: 'agent-pan-2', issueId: 'PAN-2', lastActivity: iso(30 * HOUR) }),
      ],
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state])).toEqual([['agent-pan-1', 'stopped']]);

    const week = await buildAgentDirectory(168, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-2', issueId: 'PAN-2', lastActivity: iso(30 * HOUR) })],
    }));
    expect(week.windowHours).toBe(168);
    expect(week.entries.map((entry) => entry.id)).toEqual(['agent-pan-2']);
  });

  it('lists a pan spawn pane with no state.json as a pane-only agent', async () => {
    const result = await buildAgentDirectory(24, deps({
      getBackendPanes: async () => [
        pane({ id: 'agent-pan-1-slot-2', agentId: 'agent-pan-1-slot-2', issue: 'PAN-1', role: 'worker', state: 'idle' }),
        // An operator shell Overdeck never stamped is not an agent.
        pane({ id: 'w3:p1' }),
      ],
    }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'agent-pan-1-slot-2',
      source: 'pane',
      role: 'worker',
      state: 'idle',
      issueId: 'PAN-1',
      transcript: { route: 'agent', agentId: 'agent-pan-1-slot-2' },
    });
  });

  it('never lists conv-* agent dirs as native agents', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'conv-flywheel', issueId: '' })],
      getBackendPanes: async () => [pane({ id: 'w9:p1', agentId: 'conv-flywheel' })],
      listConversations: async () => [conversation({ name: 'flywheel' })],
    }));
    expect(result.entries.map((entry) => entry.id)).toEqual(['conv:flywheel']);
  });

  it('maps conversation liveness: blocked beats working', async () => {
    const result = await buildAgentDirectory(24, deps({
      listConversations: async () => [
        conversation({ name: 'blocked', isWorking: true, pendingInputCount: 1 }),
        conversation({ name: 'working', isWorking: true }),
        conversation({ name: 'idle' }),
        conversation({ name: 'ended', sessionAlive: false, lastActivityAt: iso(HOUR) }),
        { not: 'a conversation row' },
      ],
    }));
    const states = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.state]));
    expect(states).toEqual({
      'conv:blocked': 'blocked',
      'conv:working': 'working',
      'conv:idle': 'idle',
      'conv:ended': 'stopped',
    });
    expect(result.entries.find((entry) => entry.id === 'conv:idle')).toMatchObject({
      costUsd: 1.5,
      transcript: { route: 'conversation', conversationName: 'idle' },
    });
  });

  it('lists subagents only under non-stopped parents and inherits the parent issue', async () => {
    const listAgentSubagents = vi.fn(async () => [
      { agentId: 'a1', agentType: 'Explore', description: 'find the route', mtimeMs: NOW - 10_000 },
      { agentId: 'a2', agentType: 'general-purpose', description: 'old', mtimeMs: NOW - 10 * 60_000 },
    ]);
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-1' }), agent({ id: 'agent-pan-2', issueId: 'PAN-2' })],
      getBackendPanes: async () => [pane({ id: 'w1:p1', agentId: 'agent-pan-1', issue: 'PAN-1' })],
      listAgentSubagents,
    }));
    expect(listAgentSubagents).toHaveBeenCalledTimes(1);
    expect(listAgentSubagents).toHaveBeenCalledWith('agent-pan-1', '/home/op/Projects/overdeck/workspaces/feature-pan-1');
    const subs = result.entries.filter((entry) => entry.kind === 'subagent');
    expect(subs.map((entry) => [entry.id, entry.state])).toEqual([
      ['sub:agent-pan-1:a1', 'working'],
      ['sub:agent-pan-1:a2', 'done'],
    ]);
    expect(subs[0]).toMatchObject({
      parentId: 'agent-pan-1',
      issueId: 'PAN-1',
      projectKey: 'overdeck',
      label: 'Explore · find the route',
      source: 'claude-subagent',
      transcript: { route: 'agent-subagent', agentId: 'agent-pan-1', subagentId: 'a1' },
    });
  });

  it('keeps a stopped parent when one of its children is in the window', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-1', lastActivity: iso(40 * HOUR) }),
        { ...agent({ id: 'agent-pan-1-worker-1', lastActivity: iso(HOUR) }), parentId: 'agent-pan-1' } as AgentState,
      ],
    }));
    expect(result.entries.map((entry) => entry.id).sort()).toEqual(['agent-pan-1', 'agent-pan-1-worker-1']);
    expect(result.entries.find((entry) => entry.id === 'agent-pan-1-worker-1')?.parentId).toBe('agent-pan-1');
  });

  it('assigns projectKey from the issue, then conversation projectKey, then cwd, then unassigned', async () => {
    const result = await buildAgentDirectory(24, deps({
      listConversations: async () => [
        conversation({ name: 'issue', issueId: 'pan-7', projectKey: 'other' }),
        conversation({ name: 'explicit', projectKey: 'myn' }),
        conversation({ name: 'cwd' }),
        conversation({ name: 'nowhere', cwd: '/tmp/scratch' }),
      ],
    }));
    const keys = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.projectKey]));
    expect(keys).toEqual({
      'conv:issue': 'overdeck',
      'conv:explicit': 'myn',
      'conv:cwd': 'overdeck',
      'conv:nowhere': 'unassigned',
    });
    expect(result.entries.find((entry) => entry.id === 'conv:issue')?.issueId).toBe('PAN-7');
  });

  it('marks a remote agent unknown and sorts live entries first', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-1', lastActivity: iso(1_000) }),
        agent({ id: 'agent-pan-2', issueId: 'PAN-2', lastActivity: iso(HOUR) }),
      ],
      readRemoteLocation: async (id) => (id === 'agent-pan-2' ? 'remote' : null),
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state, entry.location])).toEqual([
      ['agent-pan-2', 'unknown', 'remote'],
      ['agent-pan-1', 'stopped', 'local'],
    ]);
  });
});

describe('getAgentDirectory', () => {
  it('memoizes for 3 s and shares one in-flight build', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const listAgentStates = vi.fn(() => [agent({ id: 'agent-pan-1' })]);
    const d = deps({ listAgentStates, now: () => Date.now() });

    const [first, second] = await Promise.all([getAgentDirectory(24, d), getAgentDirectory(24, d)]);
    expect(first).toBe(second);
    await getAgentDirectory(24, d);
    expect(listAgentStates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_001);
    await getAgentDirectory(24, d);
    expect(listAgentStates).toHaveBeenCalledTimes(2);
  });
});
