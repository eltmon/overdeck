import { describe, expect, it } from 'vitest';
import { groupNodesByProject } from '../conversationProjectGroups';

type Conv = { name: string; project: string | null; isWorking?: boolean };

const node = (name: string, project: string | null, isWorking = false) => ({ conv: { name, project, isWorking } as Conv });
const groupOf = (conv: Conv) => (conv.project
  ? { key: conv.project.toLowerCase(), label: conv.project }
  : { key: '__no-project__', label: 'No project' });

describe('groupNodesByProject (PAN-5343 H-D3)', () => {
  it('orders groups by name case-insensitively with No project last, and counts working roots', () => {
    const groups = groupNodesByProject([
      node('n1', null, true),
      node('b1', 'beta', true),
      node('a1', 'Alpha'),
      node('b2', 'beta', true),
      node('a2', 'Alpha', true),
    ], groupOf);
    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'beta', 'No project']);
    expect(groups.map((g) => g.working)).toEqual([1, 2, 1]);
    expect(groups[0]!.nodes.map((n) => n.conv.name)).toEqual(['a1', 'a2']);
    expect(groups[1]!.nodes.map((n) => n.conv.name)).toEqual(['b1', 'b2']);
  });

  it('returns no groups for no nodes', () => {
    expect(groupNodesByProject([], groupOf)).toEqual([]);
  });
});
