/** PAN-4197 WI-4 — Live view classification: precedence, sections, sort, helpers. */
import type { DerivedIssueState, DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import {
  activityLabel,
  buildLiveSections,
  classifyEntry,
  lastOutputLine,
  type LiveFacts,
} from './live-model';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: 'work · PAN-1',
    location: 'local',
    projectKey: 'overdeck',
    issueId: 'PAN-1',
    issueTitle: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'idle',
    startedAt: '2026-09-25T08:00:00.000Z',
    lastActivityAt: '2026-09-25T09:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

const derived = (overrides: Partial<DerivedIssueState>): DerivedIssueState => ({ issueId: 'PAN-1', state: 'working', ...overrides });
const pr = (checks: 'green' | 'red' | 'pending') => ({ url: 'u', number: 1, reviewState: 'none' as const, checks, mergeable: null });

describe('classifyEntry — one case per precedence row', () => {
  const cases: Array<[string, DirectoryEntry, LiveFacts, { kind: string; section: string; tone: string; label: string; detail?: string | null }]> = [
    ['1 question', entry({ id: 'a', state: 'blocked' }), { pendingInputKinds: ['askUserQuestion'], pendingQuestionPrompt: 'Which one?' },
      { kind: 'question', section: 'needs-you', tone: 'needs-you', label: 'question waiting', detail: 'Which one?' }],
    ['1 permission', entry({ id: 'a', state: 'blocked' }), { pendingInputKinds: ['permissionRequest'] },
      { kind: 'permission', section: 'needs-you', tone: 'needs-you', label: 'permission prompt' }],
    ['1 plan approval', entry({ id: 'a', state: 'blocked' }), { pendingInputKinds: ['exitPlanMode'] },
      { kind: 'plan-approval', section: 'needs-you', tone: 'needs-you', label: 'plan approval' }],
    ['2 operator pause', entry({ id: 'a', pause: { by: 'operator', reason: 'lunch', since: null } }), {},
      { kind: 'paused', section: 'needs-you', tone: 'needs-you', label: 'paused by you', detail: 'lunch' }],
    ['3 api error', entry({ id: 'a', state: 'working' }), { derived: derived({ attention: 'api-error' }) },
      { kind: 'api-error', section: 'needs-you', tone: 'stuck', label: 'API error or usage limit' }],
    ['4 stuck', entry({ id: 'a', state: 'idle' }), { derived: derived({ attention: 'stuck' }) },
      { kind: 'stuck', section: 'needs-you', tone: 'stuck', label: 'stuck · idle 3h' }],
    ['5 ready to merge', entry({ id: 'a', state: 'stopped' }), { derived: derived({ state: 'ready' }) },
      { kind: 'ready-to-merge', section: 'needs-you', tone: 'needs-you', label: 'ready to merge' }],
    ['6 working', entry({ id: 'a', state: 'working' }), { runtime: { currentTool: 'Bash' } },
      { kind: 'working', section: 'live', tone: 'live', label: 'running Bash' }],
    ['7 remote', entry({ id: 'a', state: 'unknown', location: 'remote' }), {},
      { kind: 'remote', section: 'live', tone: 'live', label: 'running on Fly' }],
    ['8 held', entry({ id: 'a', state: 'stopped', pause: { by: 'scheduler', reason: 'yielded', since: null } }), {},
      { kind: 'held', section: 'waiting', tone: 'waiting', label: 'held by Overdeck', detail: 'yielded' }],
    ['9 ci failed', entry({ id: 'a', state: 'stopped' }), { derived: derived({ state: 'in-review', pr: pr('red') }) },
      { kind: 'ci-failed', section: 'waiting', tone: 'stuck', label: 'CI failed' }],
    ['10 changes requested', entry({ id: 'a', state: 'stopped' }), { derived: derived({ state: 'changes-requested' }) },
      { kind: 'changes-requested', section: 'waiting', tone: 'waiting', label: 'changes requested' }],
    ['11 in review', entry({ id: 'a', state: 'stopped' }), { derived: derived({ state: 'in-review' }) },
      { kind: 'in-review', section: 'waiting', tone: 'waiting', label: 'in review' }],
    ['12 ci running', entry({ id: 'a', state: 'stopped' }), { derived: derived({ state: 'working', pr: pr('pending') }) },
      { kind: 'ci-running', section: 'waiting', tone: 'waiting', label: 'CI running' }],
    ['13 idle', entry({ id: 'a', state: 'idle' }), {},
      { kind: 'idle', section: 'idle', tone: 'waiting', label: 'idle — no known blocker' }],
    ['14 stopped', entry({ id: 'a', state: 'stopped' }), {},
      { kind: 'stopped', section: 'idle', tone: 'waiting', label: 'agent stopped' }],
  ];

  it.each(cases)('row %s', (_name, subject, facts, expected) => {
    expect(classifyEntry(subject, facts, NOW)).toMatchObject(expected);
  });

  it('states a stuck idle age in minutes under an hour and days past two days', () => {
    const stuck = { derived: derived({ attention: 'stuck' }) };
    expect(classifyEntry(entry({ id: 'a', lastActivityAt: '2026-09-25T11:54:00.000Z' }), stuck, NOW).label).toBe('stuck · idle 6m');
    expect(classifyEntry(entry({ id: 'a', lastActivityAt: '2026-09-22T12:00:00.000Z' }), stuck, NOW).label).toBe('stuck · idle 3d');
  });

  it('applies derived issue facts only to the issue agent', () => {
    const conversation = entry({ id: 'conv:a', kind: 'conversation', role: null, state: 'idle' });
    expect(classifyEntry(conversation, { derived: derived({ state: 'ready' }) }, NOW).kind).toBe('idle');
    const reviewer = entry({ id: 'r', role: 'review', state: 'stopped' });
    expect(classifyEntry(reviewer, { derived: derived({ state: 'in-review' }) }, NOW).kind).toBe('stopped');
  });
});

describe('classifyEntry — precedence conflicts', () => {
  it('a blocked input beats an operator pause', () => {
    const subject = entry({ id: 'a', state: 'blocked', pause: { by: 'operator', reason: null, since: null } });
    expect(classifyEntry(subject, {}, NOW)).toMatchObject({ kind: 'question', section: 'needs-you', label: 'question waiting' });
  });

  it('an operator pause beats an API error', () => {
    const subject = entry({ id: 'a', pause: { by: 'operator', reason: null, since: null } });
    expect(classifyEntry(subject, { derived: derived({ attention: 'api-error' }) }, NOW).kind).toBe('paused');
  });

  it('working beats a scheduler hold', () => {
    const subject = entry({ id: 'a', state: 'working', pause: { by: 'scheduler', reason: null, since: null } });
    expect(classifyEntry(subject, {}, NOW)).toMatchObject({ kind: 'working', section: 'live' });
  });

  it('in review beats CI running', () => {
    const subject = entry({ id: 'a', state: 'stopped' });
    expect(classifyEntry(subject, { derived: derived({ state: 'in-review', pr: pr('pending') }) }, NOW).kind).toBe('in-review');
  });
});

describe('buildLiveSections', () => {
  it('nests a subagent under its parent row and drops one whose parent is absent', () => {
    const sections = buildLiveSections([
      entry({ id: 'agent-1', state: 'working' }),
      entry({ id: 'sub:agent-1:a', kind: 'subagent', parentId: 'agent-1', state: 'working' }),
      entry({ id: 'sub:gone:b', kind: 'subagent', parentId: 'gone', state: 'working' }),
    ], () => ({}), NOW);
    expect(sections.live.map((row) => row.entry.id)).toEqual(['agent-1']);
    expect(sections.live[0]!.children.map((child) => child.id)).toEqual(['sub:agent-1:a']);
    expect([...sections.needsYou, ...sections.waiting, ...sections.idle]).toEqual([]);
  });

  it('sorts Needs you oldest wait first, Live by start time, Waiting and Idle most recent first, ties by id', () => {
    const sections = buildLiveSections([
      entry({ id: 'n-10', state: 'blocked', lastActivityAt: '2026-09-25T10:00:00.000Z' }),
      entry({ id: 'n-09', state: 'blocked', lastActivityAt: '2026-09-25T09:00:00.000Z' }),
      entry({ id: 'n-none', state: 'blocked', lastActivityAt: null }),
      entry({ id: 'l-late', state: 'working', startedAt: '2026-09-25T09:00:00.000Z', lastActivityAt: '2026-09-25T11:59:00.000Z' }),
      entry({ id: 'l-early', state: 'working', startedAt: '2026-09-25T08:00:00.000Z', lastActivityAt: '2026-09-25T10:00:00.000Z' }),
      entry({ id: 'w-old', state: 'stopped', pause: { by: 'machine', reason: null, since: '2026-09-25T07:00:00.000Z' } }),
      entry({ id: 'w-new', state: 'stopped', pause: { by: 'machine', reason: null, since: '2026-09-25T08:00:00.000Z' } }),
      entry({ id: 'i-b', state: 'idle', lastActivityAt: '2026-09-25T08:00:00.000Z' }),
      entry({ id: 'i-a', state: 'idle', lastActivityAt: '2026-09-25T08:00:00.000Z' }),
    ], () => ({}), NOW);
    expect(sections.needsYou.map((row) => row.entry.id)).toEqual(['n-09', 'n-10', 'n-none']);
    expect(sections.live.map((row) => row.entry.id)).toEqual(['l-early', 'l-late']);
    expect(sections.waiting.map((row) => row.entry.id)).toEqual(['w-new', 'w-old']);
    expect(sections.idle.map((row) => row.entry.id)).toEqual(['i-a', 'i-b']);
  });

  it('keeps an idle row with no blocker out of Waiting', () => {
    const sections = buildLiveSections([entry({ id: 'plan-1', role: 'plan', state: 'idle' })], () => ({}), NOW);
    expect(sections.waiting).toEqual([]);
    expect(sections.idle.map((row) => row.entry.id)).toEqual(['plan-1']);
  });

  it('dates a Live row from the runtime snapshot and a pause row from the pause', () => {
    const sections = buildLiveSections([
      entry({ id: 'live', state: 'working' }),
      entry({ id: 'held', state: 'stopped', pause: { by: 'machine', reason: null, since: '2026-09-25T07:00:00.000Z' } }),
    ], (subject) => (subject.id === 'live' ? { runtime: { lastActivity: '2026-09-25T11:59:00.000Z' } } : {}), NOW);
    expect(sections.live[0]!.since).toBe('2026-09-25T11:59:00.000Z');
    expect(sections.waiting[0]!.since).toBe('2026-09-25T07:00:00.000Z');
  });
});

describe('activityLabel', () => {
  it('names the running tool, then thinking, else working', () => {
    expect(activityLabel({ activity: 'working', currentTool: 'Edit' })).toBe('running Edit');
    expect(activityLabel({ activity: 'thinking' })).toBe('thinking');
    expect(activityLabel(undefined)).toBe('working');
  });
});

describe('lastOutputLine', () => {
  it('returns the last non-empty line without escape codes, truncated to 160 characters', () => {
    const long = 'x'.repeat(200);
    const line = lastOutputLine(['first', `\x1b[31m${long}\x1b[0m`, '', '   ']);
    expect(line).toHaveLength(160);
    expect(line).toBe(`${'x'.repeat(159)}…`);
    expect(lastOutputLine(['\x1b[32mdone\x1b[0m', ''])).toBe('done');
    expect(lastOutputLine(undefined)).toBeNull();
    expect(lastOutputLine(['', ''])).toBeNull();
  });
});

describe('buildLiveSections — gauntlet lanes and successors (PAN-4223 FR-19, FR-29)', () => {
  const conversation = (id: string, overrides: Partial<DirectoryEntry> = {}) =>
    entry({ id, kind: 'conversation', label: id, issueId: null, role: null, source: 'conversation', state: 'working', ...overrides });
  const laneFacts = { run: 'hotel', key: '663', role: 'builder', iteration: 1, reportStatus: null } as const;
  const noFacts = () => ({});
  const factsFor = (asking: string) => (e: DirectoryEntry): LiveFacts => (e.id === asking ? { pendingInputKinds: ['askUserQuestion'] } : {});
  const rowIds = (sections: ReturnType<typeof buildLiveSections>) =>
    [...sections.needsYou, ...sections.live, ...sections.waiting, ...sections.idle].map((row) => row.entry.id);

  it('nests a working lane under its parent row and gives it no row of its own', () => {
    const sections = buildLiveSections([
      conversation('conv:root'),
      conversation('conv:lane', { parentId: 'conv:root', lane: laneFacts }),
    ], noFacts, NOW);
    expect(rowIds(sections)).toEqual(['conv:root']);
    expect(sections.live[0]?.children.map((child) => child.id)).toEqual(['conv:lane']);
  });

  it('shows a needs-you lane both in Needs you and under its parent', () => {
    const sections = buildLiveSections([
      conversation('conv:root'),
      conversation('conv:lane', { parentId: 'conv:root', lane: laneFacts, state: 'blocked' }),
    ], factsFor('conv:lane'), NOW);
    expect(sections.needsYou.map((row) => row.entry.id)).toEqual(['conv:lane']);
    expect(sections.live[0]?.children.map((child) => child.id)).toEqual(['conv:lane']);
  });

  it('keeps a lane whose parent is absent as a top-level row', () => {
    const sections = buildLiveSections([conversation('conv:lane', { parentId: 'conv:gone', lane: laneFacts })], noFacts, NOW);
    expect(rowIds(sections)).toEqual(['conv:lane']);
  });

  it('keeps a successor as its own row, not a child of its predecessor', () => {
    const sections = buildLiveSections([
      conversation('conv:root'),
      conversation('conv:next', { parentId: 'conv:root', continuesFrom: 10 }),
    ], noFacts, NOW);
    expect(rowIds(sections).sort()).toEqual(['conv:next', 'conv:root']);
    expect(sections.live.find((row) => row.entry.id === 'conv:root')?.children).toEqual([]);
  });

  it('hosts an orchestrator lane\'s builders on the root row, one level deep', () => {
    const sections = buildLiveSections([
      conversation('conv:root'),
      conversation('conv:orch', { parentId: 'conv:root', lane: { ...laneFacts, role: 'orchestrator' } }),
      conversation('conv:b1', { parentId: 'conv:orch', lane: laneFacts }),
    ], noFacts, NOW);
    expect(rowIds(sections)).toEqual(['conv:root']);
    expect(sections.live[0]?.children.map((child) => child.id)).toEqual(['conv:orch', 'conv:b1']);
  });
});

describe('buildLiveSections — critics under builders (PAN-4223 WI-23)', () => {
  const conversation = (id: string, overrides: Partial<DirectoryEntry> = {}) =>
    entry({ id, kind: 'conversation', label: id, issueId: null, role: null, source: 'conversation', state: 'working', ...overrides });
  const laneOf = (role: string, extra: Record<string, unknown> = {}) => ({ run: 'hotel', key: '663', role, iteration: 1, reportStatus: null, ...extra });

  it('follows a builder child line with its critic inside the orchestrator row', () => {
    const sections = buildLiveSections([
      conversation('conv:orch'),
      conversation('conv:critic', { parentId: 'conv:b1', lane: laneOf('critic', { criticOf: 2, verdict: 'NOT_YET' }) }),
      conversation('conv:b2', { parentId: 'conv:orch', lane: laneOf('builder', { key: '664' }) }),
      conversation('conv:b1', { parentId: 'conv:orch', lane: laneOf('builder') }),
    ], () => ({}), NOW);
    expect(sections.live.map((row) => row.entry.id)).toEqual(['conv:orch']);
    expect(sections.live[0]?.children.map((child) => child.id)).toEqual(['conv:b2', 'conv:b1', 'conv:critic']);
  });

  it('makes a critic of a builder with its own row that row\'s child line', () => {
    const sections = buildLiveSections([
      conversation('conv:b1', { parentId: 'conv:gone', lane: laneOf('builder') }),
      conversation('conv:critic', { parentId: 'conv:b1', lane: laneOf('critic', { criticOf: 2 }) }),
    ], () => ({}), NOW);
    expect(sections.live.map((row) => row.entry.id)).toEqual(['conv:b1']);
    expect(sections.live[0]?.children.map((child) => child.id)).toEqual(['conv:critic']);
  });
});
