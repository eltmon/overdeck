import type { DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { buildDirectoryTree, entriesForNode, filterRows } from './directory-tree';

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: overrides.id,
    location: 'local',
    projectKey: 'overdeck',
    issueId: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'working',
    startedAt: '2026-09-23T10:00:00.000Z',
    lastActivityAt: '2026-09-23T11:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

const ENTRIES: DirectoryEntry[] = [
  entry({ id: 'agent-pan-3920', issueId: 'PAN-3920', label: 'work · PAN-3920' }),
  entry({ id: 'agent-pan-41', issueId: 'PAN-41', state: 'stopped', label: 'work · PAN-41' }),
  entry({ id: 'conv:orchestrator', kind: 'conversation', label: 'Orchestrator', role: null, model: 'gpt-5.5' }),
  // Issue-linked worker spawned by an issue-less conversation (D6).
  entry({ id: 'agent-pan-3920-worker-1', issueId: 'PAN-3920', parentId: 'conv:orchestrator', label: 'worker · PAN-3920' }),
  entry({ id: 'conv:notes', kind: 'conversation', projectKey: 'unassigned', label: 'Notes', state: 'idle' }),
];

describe('buildDirectoryTree', () => {
  it('builds Local → project → issue and a Conversations node for issue-less entries', () => {
    const [local] = buildDirectoryTree(ENTRIES);
    expect(local?.id).toBe('loc:local');
    expect(local?.children.map((node) => node.id)).toEqual(['proj:local:overdeck', 'proj:local:unassigned']);
    expect(local?.children[0]?.children.map((node) => [node.kind, node.label])).toEqual([
      ['issue', 'PAN-3920'],
      ['issue', 'PAN-41'],
      ['conversations', 'Conversations'],
    ]);
    expect(local?.children[1]?.label).toBe('No project');
  });

  it('omits the Remote node when no entry is remote', () => {
    expect(buildDirectoryTree(ENTRIES).map((node) => node.id)).toEqual(['loc:local']);
    const withRemote = buildDirectoryTree([...ENTRIES, entry({ id: 'agent-pan-7', issueId: 'PAN-7', location: 'remote', state: 'unknown' })]);
    expect(withRemote.map((node) => [node.id, node.label])).toEqual([['loc:local', 'Local'], ['loc:remote', 'Remote (Fly)']]);
  });

  it('counts live and total per node', () => {
    const [local] = buildDirectoryTree(ENTRIES);
    expect([local?.liveCount, local?.totalCount]).toEqual([4, 5]);
    const overdeck = local?.children[0];
    expect([overdeck?.liveCount, overdeck?.totalCount]).toEqual([3, 4]);
    const issue = overdeck?.children.find((node) => node.label === 'PAN-3920');
    expect([issue?.liveCount, issue?.totalCount]).toEqual([2, 2]);
    const stopped = overdeck?.children.find((node) => node.label === 'PAN-41');
    expect([stopped?.liveCount, stopped?.totalCount]).toEqual([0, 1]);
  });
});

describe('entriesForNode', () => {
  it('lists an issue-linked child under its issue and under its parent conversation', () => {
    const convRows = entriesForNode(ENTRIES, 'convs:local:overdeck');
    expect(convRows.map((row) => [row.entry.id, row.depth])).toEqual([
      ['conv:orchestrator', 0],
      ['agent-pan-3920-worker-1', 1],
    ]);
    const issueRows = entriesForNode(ENTRIES, 'issue:local:PAN-3920').map((row) => row.entry.id);
    expect(issueRows).toContain('agent-pan-3920-worker-1');
  });

  it('marks a child whose parent is outside the node with spawnedByLabel', () => {
    const worker = entriesForNode(ENTRIES, 'issue:local:PAN-3920').find((row) => row.entry.id === 'agent-pan-3920-worker-1');
    expect(worker).toMatchObject({ depth: 0, spawnedByLabel: 'Orchestrator' });
  });

  it('returns every entry under a location, live first', () => {
    const rows = entriesForNode(ENTRIES, 'loc:local');
    expect(rows).toHaveLength(5);
    expect(rows.at(-1)?.entry.id).toBe('agent-pan-41');
  });
});

describe('filterRows', () => {
  it('filters by model substring case-insensitively', () => {
    const rows = entriesForNode(ENTRIES, 'loc:local');
    expect(filterRows(rows, 'GPT-5').map((row) => row.entry.id)).toEqual(['conv:orchestrator']);
    expect(filterRows(rows, '  ')).toHaveLength(5);
  });
});
