import { describe, expect, it } from 'vitest';
import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';
import { findLinkProblems, type LinkFindingKind } from '../../../../../src/lib/memory/facts/lint-links.js';

function fact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    scope: 'project',
    type: 'project',
    title: overrides.id,
    description: `${overrides.id} description.`,
    tags: [],
    created: null,
    updated: null,
    source: null,
    status: 'active',
    supersedes: [],
    supersededBy: null,
    review: [],
    extra: {},
    body: '',
    file: `/repo/.overdeck/memory/${overrides.id}.md`,
    ...overrides,
  };
}

const ONE_OF_EACH: MemoryFact[] = [
  fact({ id: 'ds', supersedes: ['ghost'] }),
  fact({ id: 'dsb', status: 'superseded', supersededBy: 'phantom' }),
  fact({ id: 'ow-new', supersedes: ['ow-old'] }),
  fact({ id: 'ow-old' }),
  fact({ id: 'swl', status: 'superseded' }),
  fact({ id: 'lws-new', supersedes: ['lws-old'] }),
  fact({ id: 'lws-old', supersededBy: 'lws-new' }),
  fact({ id: 'cy-a', status: 'superseded', supersedes: ['cy-b'], supersededBy: 'cy-b' }),
  fact({ id: 'cy-b', status: 'superseded', supersedes: ['cy-a'], supersededBy: 'cy-a' }),
  fact({ id: 'dfai-old', description: 'Superseded arrival rule: disable timestream for sieges and caravans.' }),
];

describe('findLinkProblems', () => {
  it('returns exactly one finding of each kind for a store seeded with one of each problem', () => {
    const findings = findLinkProblems(ONE_OF_EACH);
    const kinds: LinkFindingKind[] = [
      'dangling-supersedes',
      'dangling-superseded-by',
      'one-way-link',
      'status-without-link',
      'link-without-status',
      'cycle',
      'description-says-superseded',
    ];
    expect(findings.map((finding) => finding.kind).sort()).toEqual([...kinds].sort());
    expect(findings.map((finding) => [finding.kind, finding.id])).toEqual([
      ['cycle', 'cy-a'],
      ['description-says-superseded', 'dfai-old'],
      ['dangling-supersedes', 'ds'],
      ['dangling-superseded-by', 'dsb'],
      ['link-without-status', 'lws-old'],
      ['one-way-link', 'ow-new'],
      ['status-without-link', 'swl'],
    ]);
  });

  it('dangling-supersedes names the missing id', () => {
    const [finding] = findLinkProblems([fact({ id: 'ds', supersedes: ['ghost'] })]);
    expect(finding).toMatchObject({ kind: 'dangling-supersedes', id: 'ds', other: 'ghost' });
    expect(finding.message).toContain('no fact "ghost"');
  });

  it('dangling-superseded-by names the missing id', () => {
    const [finding] = findLinkProblems([fact({ id: 'dsb', status: 'superseded', supersededBy: 'phantom' })]);
    expect(finding).toMatchObject({ kind: 'dangling-superseded-by', id: 'dsb', other: 'phantom' });
  });

  it('one-way-link fires from either side of a half link', () => {
    expect(findLinkProblems([fact({ id: 'new', supersedes: ['old'] }), fact({ id: 'old' })])).toEqual([
      expect.objectContaining({ kind: 'one-way-link', id: 'new', other: 'old' }),
    ]);
    expect(findLinkProblems([fact({ id: 'new' }), fact({ id: 'old', status: 'superseded', supersededBy: 'new' })])).toEqual([
      expect.objectContaining({ kind: 'one-way-link', id: 'old', other: 'new' }),
    ]);
  });

  it('status-without-link fires for status superseded with no superseded_by', () => {
    expect(findLinkProblems([fact({ id: 'swl', status: 'superseded' })])).toEqual([
      expect.objectContaining({ kind: 'status-without-link', id: 'swl' }),
    ]);
  });

  it('link-without-status fires for superseded_by with status active', () => {
    expect(findLinkProblems([fact({ id: 'new', supersedes: ['old'] }), fact({ id: 'old', supersededBy: 'new' })])).toEqual([
      expect.objectContaining({ kind: 'link-without-status', id: 'old', other: 'new' }),
    ]);
  });

  it('cycle is reported once, under the smallest id, for a three-fact loop', () => {
    const findings = findLinkProblems([
      fact({ id: 'c', status: 'superseded', supersedes: ['b'], supersededBy: 'a' }),
      fact({ id: 'a', status: 'superseded', supersedes: ['c'], supersededBy: 'b' }),
      fact({ id: 'b', status: 'superseded', supersedes: ['a'], supersededBy: 'c' }),
    ]);
    expect(findings).toEqual([
      { kind: 'cycle', id: 'a', other: 'b', message: 'supersession cycle: a -> b -> c -> a' },
    ]);
  });

  it('description-says-superseded names pan memory edit for the dfai case', () => {
    const findings = findLinkProblems([
      fact({ id: 'disable-timestream-for-sieges-and-caravans', description: 'Superseded arrival rule: disable timestream.' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('description-says-superseded');
    expect(findings[0].message).toContain('pan memory edit <new-id> --supersedes disable-timestream-for-sieges-and-caravans');
  });

  it('description-says-superseded skips a fact that is already superseded', () => {
    expect(findLinkProblems([
      fact({ id: 'new', supersedes: ['old'] }),
      fact({ id: 'old', status: 'superseded', supersededBy: 'new', description: 'Superseded arrival rule.' }),
    ])).toEqual([]);
  });

  it('a clean two-fact supersession produces no findings', () => {
    expect(findLinkProblems([
      fact({ id: 'x', supersedes: ['y'] }),
      fact({ id: 'y', status: 'superseded', supersededBy: 'x' }),
    ])).toEqual([]);
  });
});
