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
  const id = overrides.id ?? 'item-1';
  const defaultMetadata = {
    requiresInspection: false,
    files_scope: [`src/${id}.ts`],
    files_scope_confidence: 'high' as const,
    readiness: 'sequential' as const,
  };

  return {
    id,
    title: 'Implement behavior',
    status: 'pending',
    narrative: { Action: 'Implement the behavior with explicit files and verification steps' },
    subItems: [
      ac(`${id}.ac1`, 'Given a valid request then it returns success'),
      ac(`${id}.ac2`, 'The command rejects invalid requests with a clear error'),
    ],
    ...overrides,
    metadata: {
      ...defaultMetadata,
      ...(overrides.metadata ?? {}),
    },
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
    expect(OBSERVABLE_TERMS).toEqual(['blocks', 'creates', 'deletes', 'displays', 'emits', 'fails', 'persists', 'records', 'redirects', 'rejects', 'renders', 'returns', 'saves', 'shows', 'stores', 'updates', 'validates', 'exits', 'prints', 'logs', 'throws', 'spawns', 'opens', 'closes', 'sends', 'receives', 'resolves', 'refuses', 'marks', 'syncs', 'commits', 'pushes', 'accepts', 'applies', 'collapses', 'contains', 'covers', 'defaults to', 'falls back', 'preserves', 'produces', 'passes', 'respects', 'routes', 'survives', 'wins', 'when ', 'given ', 'then ']); // PAN-1796 expansion
  });

  it('flags missing ACs', () => {
    expect(rulesFor([item({ subItems: [] })])).toContain('ac-missing');
  });

  it('applies AC rules equivalently to v0.6 items children', () => {
    const legacy = rulesFor([item({
      subItems: [
        ac('item-1.ac1', 'Feature works as expected'),
        ac('item-1.ac2', 'Given input then it returns output'),
      ],
    })]);
    const current = rulesFor([item({
      subItems: undefined,
      items: [
        ac('item-1.ac1', 'Feature works as expected'),
        ac('item-1.ac2', 'Given input then it returns output'),
      ],
    })]);

    expect(current).toEqual(legacy);
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

describe('lintPlanQuality dispatch metadata', () => {
  it('errors when required dispatch metadata is missing', () => {
    const candidate = item();
    candidate.metadata = { requiresInspection: false };

    expect(lintPlanQuality(doc([candidate]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-1', rule: 'files-scope-missing', severity: 'error' }),
      expect.objectContaining({ itemId: 'item-1', rule: 'files-scope-confidence-missing', severity: 'error' }),
      expect.objectContaining({ itemId: 'item-1', rule: 'readiness-missing', severity: 'error' }),
    ]));
  });

  it('errors on broad files_scope declarations', () => {
    const issues = lintPlanQuality(doc([
      item({ metadata: { files_scope: ['src/**', 'src', '*.ts'] } }),
    ]));

    expect(issues.filter(issue => issue.rule === 'files-scope-broad')).toEqual([
      expect.objectContaining({ itemId: 'item-1', severity: 'error' }),
      expect.objectContaining({ itemId: 'item-1', severity: 'error' }),
      expect.objectContaining({ itemId: 'item-1', severity: 'error' }),
    ]);
  });

  it('errors when readiness ready uses low confidence scope', () => {
    expect(lintPlanQuality(doc([
      item({ metadata: { readiness: 'ready', files_scope_confidence: 'low' } }),
    ]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-1', rule: 'ready-low-confidence', severity: 'error' }),
    ]));
  });

  it('warns when complex ready work does not state why it is parallel-safe', () => {
    expect(lintPlanQuality(doc([
      item({ metadata: { difficulty: 'complex', readiness: 'ready' } }),
    ]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-1', rule: 'complex-ready-without-reason', severity: 'warn' }),
    ]));
  });

  it('accepts complex ready work with an explicit parallel-safe reason', () => {
    const issues = lintPlanQuality(doc([
      item({ metadata: { difficulty: 'complex', readiness: 'ready', parallelSafeReason: 'The item only touches one isolated file with its own verification.' } }),
    ]));

    expect(issues.map(issue => issue.rule)).not.toContain('complex-ready-without-reason');
  });

  it('errors when expected_outputs reuses a banned acceptance-criteria phrase', () => {
    expect(lintPlanQuality(doc([
      item({ metadata: { expected_outputs: ['passes tests'] } }),
    ]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'item-1', rule: 'expected-output-banned-phrase', severity: 'error' }),
    ]));
  });
});

describe('lintPlanQuality DAG and references', () => {
  function validItem(id: string, overrides: Partial<VBriefItem> = {}): VBriefItem {
    return item({
      id,
      title: id,
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
    const candidate = validItem('a');
    const metadata = { ...(candidate.metadata ?? {}) };
    delete metadata.requiresInspection;
    candidate.metadata = metadata;

    const issues = lintPlanQuality(doc([
      candidate,
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

describe('lintPlanQuality observable-term tuning (PAN-1796)', () => {
  const planWith = (acTitle: string) => ({
    vBRIEFInfo: { version: '0.6', created: 'x' },
    plan: {
      id: 'pan-1', title: 't', status: 'approved',
      items: [{
        id: 'a', title: 'item a', status: 'pending',
        metadata: {
          requiresInspection: false,
          files_scope: ['src/a.ts'],
          files_scope_confidence: 'high',
          readiness: 'sequential',
        },
        narrative: { Action: 'Do a concrete focused thing across the named files now' },
        items: [
          { id: 'a.ac1', title: acTitle, status: 'pending', metadata: { kind: 'acceptance_criterion' } },
          { id: 'a.ac2', title: 'The command exits 0 on the happy path', status: 'pending', metadata: { kind: 'acceptance_criterion' } },
        ],
      }],
      edges: [],
    },
  }) as any;

  it.each([
    'The alias applies at role tier when only specialist_harnesses is set',
    'resolveHarness falls back to claude-code when the binary is absent',
    'The select defaults to the built-in harness when no override is set',
    'Loading a pre-change snapshot survives without error',
    'The full precedence-matrix unit suite passes',
  ])('accepts natural engineering phrasing: %s', (title) => {
    const errors = lintPlanQuality(planWith(title)).filter((i: any) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('still bans "passes tests" even though "passes" is observable', () => {
    const errors = lintPlanQuality(planWith('The feature passes tests')).filter((i: any) => i.severity === 'error');
    expect(errors.some((i: any) => i.rule === 'ac-banned-phrase')).toBe(true);
  });
});
