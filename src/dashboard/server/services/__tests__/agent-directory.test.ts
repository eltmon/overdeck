/**
 * PAN-3920 W3 — the Agents Directory read model. Every source is injected;
 * nothing touches ~/.overdeck, tmux, Herdr or overdeck.db.
 */
import type { BackendPane } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../../../lib/agents/agent-state-read.js';
import type { ExternalRegistration } from '../../../../lib/agents/external-registry.js';
import { listExternalCandidates, type ExternalDirectorySources } from '../agent-directory-external.js';
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
    readRemoteState: async () => null,
    listConversationSubagents: async () => [],
    listAgentSubagents: async () => [],
    issueTitles: () => new Map(),
    listExternalEntries: async () => [],
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

  it('carries the cached issue title onto every entry of that issue, and null when unknown', async () => {
    const result = await buildAgentDirectory(24, deps({
      issueTitles: () => new Map([['PAN-1', 'Agents page as a directory']]),
      listAgentStates: () => [agent({ id: 'agent-pan-1' }), agent({ id: 'agent-pan-2', issueId: 'pan-2' })],
      getBackendPanes: async () => [pane({ id: 'w1:p1', agentId: 'agent-pan-1', issue: 'PAN-1' })],
      listAgentSubagents: async () => [{ agentId: 'a1', agentType: 'Explore', description: 'd', mtimeMs: NOW - 10_000 }],
      listConversations: async () => [conversation({ name: 'free' })],
    }));
    const titles = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.issueTitle]));
    expect(titles).toEqual({
      'agent-pan-1': 'Agents page as a directory',
      'sub:agent-pan-1:a1': 'Agents page as a directory',
      'agent-pan-2': null,
      'conv:free': null,
    });
  });

  it('takes a subagent model from its transcript, else the parent model', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-1', model: 'claude-opus-5-5' })],
      getBackendPanes: async () => [pane({ id: 'w1:p1', agentId: 'agent-pan-1', issue: 'PAN-1' })],
      listAgentSubagents: async () => [
        { agentId: 'a1', agentType: 'Explore', description: 'd', mtimeMs: NOW, model: 'claude-haiku-5' },
        { agentId: 'a2', agentType: 'Explore', description: 'd', mtimeMs: NOW, model: null },
      ],
    }));
    const models = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.model]));
    expect(models['sub:agent-pan-1:a1']).toBe('claude-haiku-5');
    expect(models['sub:agent-pan-1:a2']).toBe('claude-opus-5-5');
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
      readRemoteState: async (id) => (id === 'agent-pan-2' ? { location: 'remote', status: 'running' } : null),
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state, entry.location])).toEqual([
      ['agent-pan-2', 'unknown', 'remote'],
      ['agent-pan-1', 'stopped', 'local'],
    ]);
  });

  it('treats a stopped or failed remote agent as stopped, so it windows out', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-3', issueId: 'PAN-3', lastActivity: iso(HOUR) }),
        agent({ id: 'agent-pan-4', issueId: 'PAN-4', lastActivity: iso(HOUR) }),
        agent({ id: 'agent-pan-5', issueId: 'PAN-5', lastActivity: iso(30 * HOUR) }),
      ],
      readRemoteState: async (id) => ({ location: 'remote', status: id === 'agent-pan-4' ? 'error' : 'stopped' }),
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state])).toEqual([
      ['agent-pan-3', 'stopped'],
      ['agent-pan-4', 'stopped'],
    ]);
  });

  it('treats a remote agent whose state.json says stopped as stopped, even while remote-state.json says running', async () => {
    // `pan kill` with the remote unreachable skips the VM teardown and writes
    // only state.json; the directory must not keep that agent live forever.
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-6', issueId: 'PAN-6', status: 'stopped', lastActivity: iso(HOUR) }),
        agent({ id: 'agent-pan-7', issueId: 'PAN-7', status: 'error', lastActivity: iso(HOUR) }),
        agent({ id: 'agent-pan-8', issueId: 'PAN-8', status: 'stopped', lastActivity: iso(30 * HOUR) }),
      ],
      readRemoteState: async () => ({ location: 'remote', status: 'running', startedAt: iso(40 * HOUR) }),
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state])).toEqual([
      ['agent-pan-6', 'stopped'],
      ['agent-pan-7', 'stopped'],
    ]);
  });

  it('keeps a relaunched remote agent live although state.json still holds the previous run\'s stop', async () => {
    // `pan start --remote` writes only remote-state.json; state.json keeps the
    // `stopped` that remote completion (or a killed local run) wrote earlier.
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-9', issueId: 'PAN-9', status: 'stopped', stoppedAt: iso(3 * HOUR), lastActivity: iso(3 * HOUR) }),
      ],
      readRemoteState: async () => ({ location: 'remote', status: 'running', startedAt: iso(HOUR) }),
    }));
    expect(result.entries.map((entry) => [entry.id, entry.state, entry.location])).toEqual([
      ['agent-pan-9', 'unknown', 'remote'],
    ]);
  });

  it('consults the project lookups once per distinct issue and path in a build', async () => {
    const projectKeyForIssue = vi.fn(() => 'overdeck');
    const projectKeyForPath = vi.fn(() => 'overdeck');
    await buildAgentDirectory(24, deps({
      projectKeyForIssue,
      projectKeyForPath,
      listConversations: async () => [
        conversation({ name: 'a' }), conversation({ name: 'b' }), conversation({ name: 'c', issueId: 'PAN-9' }),
        conversation({ name: 'd', issueId: 'PAN-9' }),
      ],
    }));
    expect(projectKeyForIssue).toHaveBeenCalledTimes(1);
    expect(projectKeyForPath).toHaveBeenCalledTimes(1);
  });

  // PAN-3920 W15: registered workers.
  it('shows a worker under its parent conversation and its issue', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({
        id: 'agent-pan-1-worker-2',
        role: 'worker',
        parentId: 'conv-orchestrator',
        workspace: '/home/op/Projects/overdeck/workspaces/feature-pan-1/.swarm/worker-2',
      })],
      getBackendPanes: async () => [pane({ id: 'w1:p9', agentId: 'agent-pan-1-worker-2', issue: 'PAN-1', role: 'worker', state: 'working' })],
      listConversations: async () => [conversation({ name: 'orchestrator', tmuxSession: 'conv-orchestrator' })],
      readWorkerName: async () => 'second-opinion',
      latestWorkerReportAt: async () => null,
    }));
    const worker = result.entries.find((entry) => entry.id === 'agent-pan-1-worker-2');
    expect(worker).toMatchObject({
      kind: 'agent',
      role: 'worker',
      label: 'worker · PAN-1 · second-opinion',
      issueId: 'PAN-1',
      parentId: 'conv:orchestrator',
      state: 'working',
      projectKey: 'overdeck',
      transcript: { route: 'agent', agentId: 'agent-pan-1-worker-2' },
    });
    expect(result.entries.map((entry) => entry.id)).toContain('conv:orchestrator');
  });

  it('labels a worker by number and keeps an agent parent id as is', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [
        agent({ id: 'agent-pan-1-review', role: 'review' }),
        agent({ id: 'agent-pan-1-worker-3', role: 'worker', parentId: 'agent-pan-1-review' }),
      ],
      readWorkerName: async () => null,
      latestWorkerReportAt: async () => null,
    }));
    expect(result.entries.find((entry) => entry.id === 'agent-pan-1-worker-3')).toMatchObject({
      label: 'worker · PAN-1 · 3',
      parentId: 'agent-pan-1-review',
    });
  });

  it('marks an idle worker done when its latest report is newer than the idle transition', async () => {
    const idleSince = NOW - 30_000;
    const build = (reportAt: number | null) => buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-1-worker-1', role: 'worker', parentId: 'agent-pan-1' })],
      getBackendPanes: async () => [pane({ id: 'w1:p3', agentId: 'agent-pan-1-worker-1', role: 'worker', state: 'idle', stateSince: idleSince })],
      readWorkerName: async () => null,
      latestWorkerReportAt: async () => reportAt,
    }));

    // Newer than the idle transition, or written in the turn that just ended.
    expect((await build(idleSince + 1_000)).entries[0]!.state).toBe('done');
    expect((await build(idleSince - 20_000)).entries[0]!.state).toBe('done');
    // A report from an earlier turn: the follow-up went idle without reporting.
    expect((await build(idleSince - 30 * 60_000)).entries[0]!.state).toBe('idle');
    expect((await build(null)).entries[0]!.state).toBe('idle');
  });

  it('never marks a non-worker done from a report', async () => {
    const result = await buildAgentDirectory(24, deps({
      listAgentStates: () => [agent({ id: 'agent-pan-1' })],
      getBackendPanes: async () => [pane({ id: 'w1:p1', agentId: 'agent-pan-1', state: 'idle' })],
      latestWorkerReportAt: async () => NOW,
    }));
    expect(result.entries[0]!.state).toBe('idle');
  });
});

function registration(overrides: Partial<ExternalRegistration> & { id: string }): ExternalRegistration {
  return {
    source: 'codex-plugin',
    externalId: overrides.id.replace(/^ext-codex-plugin-/, ''),
    registeredBy: 'codex-plugin',
    harness: 'codex',
    model: 'gpt-5.6-sol',
    cwd: '/home/op/Projects/overdeck/workspaces/feature-pan-7',
    issueId: 'PAN-7',
    parentId: 'conv-alpha',
    label: 'Fix the flaky test',
    pid: 4242,
    pidStartTime: '9001',
    logFile: null,
    registeredAt: iso(10 * 60_000),
    ...overrides,
  };
}

/** Registrations with injected liveness, transcript and turn state — no fs, no /proc. */
function external(
  registrations: ExternalRegistration[],
  facts: Partial<ExternalDirectorySources> & { rolloutMtime?: number | null } = {},
): Pick<AgentDirectoryDeps, 'listExternalEntries'> {
  const sources: ExternalDirectorySources = {
    listRegistrations: async () => registrations,
    liveness: async () => 'alive',
    resolveTranscript: async (r) => ({ kind: 'codex', path: `/rollouts/${r.id}.jsonl` }),
    mtimeMs: async () => (facts.rolloutMtime === undefined ? NOW - 5_000 : facts.rolloutMtime),
    turnComplete: async () => false,
    ...facts,
  };
  return { listExternalEntries: (now) => listExternalCandidates(now, sources) };
}

describe('buildAgentDirectory — external agents (Phase C)', () => {
  it('lists a running plugin job under its parent conversation as working', async () => {
    const result = await buildAgentDirectory(24, deps({
      listConversations: async () => [conversation({ name: 'alpha', tmuxSession: 'conv-alpha', isWorking: true })],
      ...external([registration({ id: 'ext-codex-plugin-task-1' })]),
    }));
    const entry = result.entries.find((e) => e.id === 'ext-codex-plugin-task-1')!;
    expect(entry).toMatchObject({
      kind: 'external',
      source: 'codex-plugin',
      state: 'working',
      parentId: 'conv:alpha',
      issueId: 'PAN-7',
      projectKey: 'overdeck',
      harness: 'codex',
      model: 'gpt-5.6-sol',
      label: 'Fix the flaky test',
      location: 'local',
      transcript: { route: 'agent', agentId: 'ext-codex-plugin-task-1' },
      lastActivityAt: iso(5_000),
    });
  });

  it('shows a finished plugin job as done from its rollout', async () => {
    const result = await buildAgentDirectory(24, deps(external(
      [registration({ id: 'ext-codex-plugin-task-2', pid: null, pidStartTime: null, parentId: 'claude-session:b4e68a48' })],
      { liveness: async () => 'unknown', turnComplete: async () => true, rolloutMtime: NOW - 3 * HOUR },
    )));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ state: 'done', parentId: 'claude-session:b4e68a48', lastActivityAt: iso(3 * HOUR) });
  });

  it('shows a dead pid with an incomplete transcript as stopped', async () => {
    const result = await buildAgentDirectory(24, deps(external(
      [registration({ id: 'ext-codex-plugin-task-3' })],
      { liveness: async () => 'dead', turnComplete: async () => false },
    )));
    expect(result.entries[0]!.state).toBe('stopped');
  });

  it('drops an old finished job outside the window, keeps a pid-less one that is still writing, and has no transcript ref without a candidate', async () => {
    const result = await buildAgentDirectory(24, deps(external(
      [
        registration({ id: 'ext-codex-plugin-old', registeredAt: iso(3 * 24 * HOUR) }),
        registration({ id: 'ext-my-tool-run-7', source: 'registered', pid: null, pidStartTime: null, parentId: null, issueId: null, cwd: '/elsewhere' }),
      ],
      {
        liveness: async (r) => (r.pid === null ? 'unknown' : 'dead'),
        resolveTranscript: async (r) => (r.id === 'ext-codex-plugin-old' ? null : { kind: 'claude', path: '/t/run-7.jsonl' }),
        mtimeMs: async () => NOW - 30_000,
      },
    )));
    expect(result.entries.map((e) => e.id)).toEqual(['ext-my-tool-run-7']);
    expect(result.entries[0]).toMatchObject({ state: 'working', source: 'registered', projectKey: 'unassigned' });

    const old = await buildAgentDirectory(168, deps(external(
      [registration({ id: 'ext-codex-plugin-old', registeredAt: iso(3 * 24 * HOUR) })],
      { liveness: async () => 'dead', resolveTranscript: async () => null },
    )));
    expect(old.entries[0]).toMatchObject({ state: 'stopped', transcript: null, lastActivityAt: iso(3 * 24 * HOUR) });
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
