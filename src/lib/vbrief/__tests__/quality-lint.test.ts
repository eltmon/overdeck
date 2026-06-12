import { describe, expect, it } from 'vitest';
import { lintPlanQuality, OBSERVABLE_TERMS, PLACEHOLDER_AC_PATTERNS, DOCS_ONLY_AC_PATTERNS, VAGUE_AC_PATTERNS } from '../quality-lint.js';
import type { VBriefDocument, VBriefItem } from '../types.js';

function ac(id: string, title: string) {
  return {
    id,
    title,
    status: 'pending' as const,
    metadata: { kind: 'acceptance_criterion' },
  };
}

function item(overrides: Partial<VBriefItem> = {}): VBriefItem {
  return {
    id: 'item-1',
    title: 'Implement behavior',
    status: 'pending',
    narrative: { Action: 'Implement the behavior with explicit files and verification steps' },
    metadata: { requiresInspection: false },
    subItems: [
      ac('item-1.ac1', 'Given a valid request then it returns success'),
      ac('item-1.ac2', 'The command rejects invalid requests with a clear error'),
    ],
    ...overrides,
  };
}

function doc(items: VBriefItem[]): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.5',
      created: '2026-06-12T00:00:00Z',
    },
    plan: {
      id: 'PAN-1788',
      title: 'Plan',
      status: 'proposed',
      items,
      edges: [],
    },
  };
}

function rulesFor(items: VBriefItem[]): string[] {
  return lintPlanQuality(doc(items)).map(issue => issue.rule);
}

describe('lintPlanQuality story quality', () => {
  it('exports the PRD pattern constants', () => {
    expect(PLACEHOLDER_AC_PATTERNS).toEqual(['acceptance criteria for', 'copy from parent', 'copy from specification', 'placeholder', 'refine from parent', 'tbd', 'to be defined', 'to refine', 'todo']);
    expect(DOCS_ONLY_AC_PATTERNS).toEqual(['docs updated', 'documentation updated', 'readme updated', 'update docs', 'update documentation', 'update readme']);
    expect(VAGUE_AC_PATTERNS).toEqual(['displays a message', 'handles errors', 'is implemented', 'is updated', 'passes tests', 'shows a message', 'updates the ui', 'works as expected', 'make it work', 'implement the feature', 'change the code', 'update the code']);
    expect(OBSERVABLE_TERMS).toEqual(['blocks', 'creates', 'deletes', 'displays', 'emits', 'fails', 'persists', 'records', 'redirects', 'rejects', 'renders', 'returns', 'saves', 'shows', 'stores', 'updates', 'validates', 'exits', 'prints', 'logs', 'throws', 'spawns', 'opens', 'closes', 'sends', 'receives', 'resolves', 'refuses', 'marks', 'syncs', 'commits', 'pushes', 'when ', 'given ', 'then ']);
  });

  it('flags missing ACs', () => {
    expect(rulesFor([item({ subItems: [] })])).toContain('ac-missing');
  });

  it('flags 1 AC without justification', () => {
    expect(rulesFor([item({ subItems: [ac('item-1.ac1', 'Given input then it returns output')] })])).toContain('ac-count');
  });

  it('accepts 1 AC with acJustification', () => {
    expect(rulesFor([item({
      metadata: { requiresInspection: false, acJustification: 'One observable end-to-end criterion covers the full change.' },
      subItems: [ac('item-1.ac1', 'Given input then it returns output')],
    })])).not.toContain('ac-count');
  });

  it('flags "works as expected"', () => {
    expect(rulesFor([item({ subItems: [ac('item-1.ac1', 'Feature works as expected'), ac('item-1.ac2', 'Given input then it returns output')] })])).toContain('ac-banned-phrase');
  });

  it('flags docs-only AC', () => {
    expect(rulesFor([item({ subItems: [ac('item-1.ac1', 'Docs updated for the new behavior'), ac('item-1.ac2', 'Given input then it returns output')] })])).toContain('ac-banned-phrase');
  });

  it('flags AC with no observable term', () => {
    expect(rulesFor([item({ subItems: [ac('item-1.ac1', 'The new behavior follows the selected approach'), ac('item-1.ac2', 'Given input then it returns output')] })])).toContain('ac-not-observable');
  });

  it('accepts Given/When/Then AC', () => {
    expect(rulesFor([item({ subItems: [ac('item-1.ac1', 'Given a valid request when submitted then it returns success'), ac('item-1.ac2', 'The command rejects invalid requests with a clear error')] })])).not.toContain('ac-not-observable');
  });

  it('accepts 3 observable ACs', () => {
    expect(lintPlanQuality(doc([item({
      subItems: [
        ac('item-1.ac1', 'Valid requests returns success'),
        ac('item-1.ac2', 'The command rejects invalid requests with a clear error'),
        ac('item-1.ac3', 'The change emits an audit record'),
      ],
    })]))).toEqual([]);
  });

  it('flags thin Action narrative', () => {
    expect(rulesFor([item({ narrative: { Action: 'Do it' } })])).toContain('action-too-thin');
  });

  it('skips cancelled items', () => {
    expect(lintPlanQuality(doc([item({
      status: 'cancelled',
      narrative: { Action: '' },
      subItems: [],
    })]))).toEqual([]);
  });
});

describe('lintPlanQuality DAG and references', () => {
  function validItem(id: string, overrides: Partial<VBriefItem> = {}): VBriefItem {
    return item({
      id,
      title: id,
      metadata: { requiresInspection: false },
      subItems: [
        ac(`${id}.ac1`, 'Given input then it returns output'),
        ac(`${id}.ac2`, 'The command rejects invalid input'),
      ],
      ...overrides,
    });
  }

  it('flags unknown edge target', () => {
    const issues = lintPlanQuality({
      ...doc([validItem('a')]),
      plan: {
        ...doc([validItem('a')]).plan,
        edges: [{ from: 'a', to: 'missing', type: 'blocks' }],
      },
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'edge-unknown-id', message: expect.stringContaining('missing') }),
    ]));
  });

  it('flags blocks cycle A->B->A', () => {
    const issues = lintPlanQuality({
      ...doc([validItem('a'), validItem('b')]),
      plan: {
        ...doc([validItem('a'), validItem('b')]).plan,
        edges: [
          { from: 'a', to: 'b', type: 'blocks' },
          { from: 'b', to: 'a', type: 'blocks' },
        ],
      },
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'edge-cycle' }),
    ]));
  });

  it('accepts acyclic DAG', () => {
    const plan = doc([validItem('a'), validItem('b'), validItem('c')]);
    plan.plan.edges = [
      { from: 'a', to: 'b', type: 'blocks' },
      { from: 'b', to: 'c', type: 'blocks' },
    ];

    expect(lintPlanQuality(plan)).toEqual([]);
  });

  it('flags foundationFor pointing nowhere', () => {
    const issues = lintPlanQuality(doc([
      validItem('a', { metadata: { requiresInspection: true, foundationFor: ['missing'] } }),
      validItem('b'),
    ]));

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'a', rule: 'foundationFor-unknown-id' }),
    ]));
  });

  it('flags requiresInspection true with empty foundationFor', () => {
    const issues = lintPlanQuality(doc([
      validItem('a', { metadata: { requiresInspection: true, foundationFor: [] } }),
      validItem('b'),
    ]));

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'a', rule: 'inspection-without-foundation' }),
    ]));
  });

  it('flags missing requiresInspection', () => {
    const issues = lintPlanQuality(doc([
      validItem('a', { metadata: {} }),
    ]));

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'a', rule: 'inspection-missing' }),
    ]));
  });
});

describe('lintPlanQuality requirement traces', () => {
  it('warns on FR declared in PRD but traced by no item', () => {
    const issues = lintPlanQuality(doc([item()]), {
      prdText: [
        '## Requirements',
        '- FR-1 The command returns success',
        '- NFR-2 The command exits quickly',
      ].join('\n'),
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'trace-uncovered', severity: 'warn', message: expect.stringContaining('FR-1') }),
      expect.objectContaining({ rule: 'trace-uncovered', severity: 'warn', message: expect.stringContaining('NFR-2') }),
    ]));
  });

  it('silent when no PRD text provided', () => {
    expect(rulesFor([item()])).not.toContain('trace-uncovered');
  });

  it('silent when all FRs traced', () => {
    const issues = lintPlanQuality(doc([
      item({ metadata: { requiresInspection: false, traces: ['FR-1', 'NFR-2'] } }),
    ]), {
      prdText: [
        '## Requirements',
        '- FR-1 The command returns success',
        '- NFR-2 The command exits quickly',
      ].join('\n'),
    });

    expect(issues.map(issue => issue.rule)).not.toContain('trace-uncovered');
  });
});
