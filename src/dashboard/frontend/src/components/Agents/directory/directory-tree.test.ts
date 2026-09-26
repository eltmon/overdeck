import type { DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { buildDirectoryTree, entriesForNode, filterRows, parentLabel } from './directory-tree';

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: overrides.id,
    location: 'local',
    projectKey: 'overdeck',
    issueId: null,
    issueTitle: null,
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
  entry({ id: 'agent-pan-3920', issueId: 'PAN-3920', issueTitle: 'Agents page as a directory', label: 'work · PAN-3920' }),
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

  it('gives an issue node its title and leaves it null when unknown', () => {
    const [local] = buildDirectoryTree(ENTRIES);
    const issues = local?.children[0]?.children.filter((node) => node.kind === 'issue');
    expect(issues?.map((node) => [node.label, node.title])).toEqual([
      ['PAN-3920', 'Agents page as a directory'],
      ['PAN-41', null],
    ]);
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

  it('names an unknown Claude-session parent of an external agent by its first 8 characters', () => {
    const job = entry({
      id: 'ext-codex-plugin-task-1', kind: 'external', source: 'codex-plugin', role: null, issueId: 'PAN-3920',
      parentId: 'claude-session:b4e68a48-1e09-4d98-92ef-e522535f1e58',
    });
    const rows = entriesForNode([...ENTRIES, job], 'issue:local:PAN-3920');
    expect(rows.find((row) => row.entry.id === job.id)).toMatchObject({ depth: 0, spawnedByLabel: 'Claude session b4e68a48' });
    expect(parentLabel('agent-pan-9', undefined)).toBe('agent-pan-9');
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

describe('entriesForNode — lanes and successors (PAN-4223 WI-11)', () => {
  const conv = (id: string, overrides: Partial<DirectoryEntry> = {}) =>
    entry({ id, kind: 'conversation', label: id.replace('conv:', ''), role: null, source: 'conversation', ...overrides });

  it('nests a lane and a successor at depth 1 under their parent conversation', () => {
    const rows = entriesForNode([
      conv('conv:root'),
      conv('conv:lane', { parentId: 'conv:root', lane: { run: 'hotel', key: '663', role: 'builder', iteration: 1, reportStatus: null } }),
      conv('conv:next', { parentId: 'conv:root', continuesFrom: 10 }),
    ], 'convs:local:overdeck');
    expect(rows.map((row) => [row.entry.id, row.depth])).toEqual([['conv:root', 0], ['conv:lane', 1], ['conv:next', 1]]);
  });

  it('caps a four-long succession chain at depth 2 and names the flattened row\'s real parent', () => {
    const rows = entriesForNode([
      conv('conv:a'),
      conv('conv:b', { parentId: 'conv:a', continuesFrom: 1 }),
      conv('conv:c', { parentId: 'conv:b', continuesFrom: 2 }),
      conv('conv:d', { parentId: 'conv:c', continuesFrom: 3 }),
    ], 'convs:local:overdeck');
    expect(rows.map((row) => [row.entry.id, row.depth])).toEqual([['conv:a', 0], ['conv:b', 1], ['conv:c', 2], ['conv:d', 2]]);
    expect(rows.map((row) => row.flattenedFrom)).toEqual([null, null, null, 'c']);
  });
});
