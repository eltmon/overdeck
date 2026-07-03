/**
 * PAN-1791 supervisor-verdict-surface tests.
 *
 * ac3 — for each subscribed commit, the supervisor receives the bead's
 *       acceptance criteria alongside the diff (+ traced PRD FR text when
 *       metadata.traces is present).
 * ac1/ac2 message contract — the composed request targets ONLY the existing
 *       /api/specialists/done inspect surface (no new endpoint), requires
 *       the "Bead <beadId>" notes prefix the server parses, and restates
 *       that a blocking finding never changes tracker status.
 */

import { describe, expect, it, vi } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../vbrief/types.js';
import {
  buildSupervisorReviewMessage,
  deliverCommitForReview,
  extractAcceptanceCriteria,
  extractTracedFrText,
  shouldHaltDispatch,
  type SupervisorVerdict,
  type SupervisorReviewEvent,
} from '../tier-supervisor.js';

const PRD_MARKDOWN = `# Some PRD

## Requirements

- **FR-3 — Standing tier agents.** Tier agents are pre-instantiated registered sessions.
- **FR-4 — Event-driven supervisor.** A standing supervisor session subscribes to commit events and responds with an ack or a blocking finding on the existing inspect-status surface.
- **FR-5 — Replay-based crash recovery.** Dead standing sessions are respawned.

## Design
`;

function makeItem(overrides: Partial<VBriefItem> = {}): VBriefItem {
  return {
    id: 'pan-9999-3',
    title: 'Wire the widget into the frobnicator',
    status: 'running',
    metadata: { difficulty: 'complex', traces: ['FR-4'] },
    items: [
      {
        id: 'pan-9999-3.ac1',
        title: 'The widget renders inside the frobnicator panel',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
      {
        id: 'pan-9999-3.ac2',
        title: 'Clicking the widget emits a frob event',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
      {
        id: 'pan-9999-3.note',
        title: 'Not a criterion',
        status: 'pending',
        metadata: { kind: 'note' },
      },
    ],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SupervisorReviewEvent> = {}): SupervisorReviewEvent {
  return {
    issueId: 'PAN-9999',
    beadId: 'pan-9999-3',
    beadTitle: 'Wire the widget into the frobnicator',
    sha: 'abcdef0123456789',
    diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+export const widget = 1;',
    acceptanceCriteria: [
      'The widget renders inside the frobnicator panel',
      'Clicking the widget emits a frob event',
    ],
    apiUrl: 'http://localhost:3011',
    ...overrides,
  };
}

function makeDag(): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.6.0',
      created: '2026-07-02T00:00:00Z',
    },
    plan: {
      id: 'PAN-9999',
      title: 'Test plan',
      status: 'approved',
      items: [
        { id: 'foundation', title: 'Foundation', status: 'completed' },
        { id: 'dependent', title: 'Dependent', status: 'pending' },
        { id: 'unrelated', title: 'Unrelated', status: 'pending' },
        { id: 'leaf', title: 'Leaf', status: 'pending' },
      ],
      edges: [
        { from: 'foundation', to: 'dependent', type: 'blocks' },
        { from: 'dependent', to: 'leaf', type: 'blocks' },
      ],
    },
  };
}

function verdict(overrides: Partial<SupervisorVerdict>): SupervisorVerdict {
  return {
    beadId: 'foundation',
    status: 'failed',
    ...overrides,
  };
}

describe('extractAcceptanceCriteria', () => {
  it('returns only acceptance_criterion child titles, in order', () => {
    expect(extractAcceptanceCriteria(makeItem())).toEqual([
      'The widget renders inside the frobnicator panel',
      'Clicking the widget emits a frob event',
    ]);
  });

  it('reads legacy v0.5 subItems as an alias for items', () => {
    const item = makeItem();
    const legacy: VBriefItem = { ...item, items: undefined, subItems: item.items };
    expect(extractAcceptanceCriteria(legacy)).toEqual([
      'The widget renders inside the frobnicator panel',
      'Clicking the widget emits a frob event',
    ]);
  });

  it('returns empty for an item without children', () => {
    expect(extractAcceptanceCriteria(makeItem({ items: undefined }))).toEqual([]);
  });
});

describe('shouldHaltDispatch', () => {
  it('returns true when an unresolved blocking finding exists on a dependency (ac1)', () => {
    expect(
      shouldHaltDispatch(
        [verdict({ beadId: 'foundation', status: 'failed' })],
        { id: 'dependent' },
        makeDag(),
      ),
    ).toBe(true);
  });

  it('returns false once a fix commit for the dependency is acked (ac2)', () => {
    expect(
      shouldHaltDispatch(
        [
          verdict({ beadId: 'foundation', status: 'failed' }),
          verdict({ beadId: 'foundation', status: 'passed' }),
        ],
        { id: 'dependent' },
        makeDag(),
      ),
    ).toBe(false);
  });

  it('permits unrelated dispatch when the blocked bead is not a dependency (ac3)', () => {
    expect(
      shouldHaltDispatch(
        [verdict({ beadId: 'foundation', status: 'blocked' })],
        { id: 'unrelated' },
        makeDag(),
      ),
    ).toBe(false);
  });

  it('halts on transitive dependencies through blocks edges', () => {
    expect(
      shouldHaltDispatch(
        [verdict({ beadId: 'foundation', status: 'failed' })],
        { id: 'leaf' },
        makeDag(),
      ),
    ).toBe(true);
  });
});

describe('extractTracedFrText', () => {
  it('extracts the requirement bullet for a traced FR id', () => {
    const text = extractTracedFrText(PRD_MARKDOWN, ['FR-4']);
    expect(text).toContain('**FR-4 — Event-driven supervisor.**');
    expect(text).not.toContain('FR-3');
    expect(text).not.toContain('FR-5');
  });

  it('joins multiple traced requirements', () => {
    const text = extractTracedFrText(PRD_MARKDOWN, ['FR-3', 'FR-5']);
    expect(text).toContain('**FR-3 — Standing tier agents.**');
    expect(text).toContain('**FR-5 — Replay-based crash recovery.**');
  });

  it('returns undefined when no trace resolves', () => {
    expect(extractTracedFrText(PRD_MARKDOWN, ['FR-99'])).toBeUndefined();
    expect(extractTracedFrText(PRD_MARKDOWN, [])).toBeUndefined();
  });

  it('does not match FR ids that merely share a prefix', () => {
    const prd = '- **FR-1 — One.** First.\n- **FR-10 — Ten.** Tenth.\n';
    const text = extractTracedFrText(prd, ['FR-1']);
    expect(text).toContain('**FR-1 — One.**');
    expect(text).not.toContain('FR-10');
  });
});

describe('buildSupervisorReviewMessage', () => {
  it('includes the diff and every acceptance criterion (ac3)', () => {
    const event = makeEvent();
    const message = buildSupervisorReviewMessage(event);
    expect(message).toContain(event.diff);
    for (const ac of event.acceptanceCriteria) {
      expect(message).toContain(ac);
    }
  });

  it('includes traced FR text when present and omits the section otherwise', () => {
    const withFr = buildSupervisorReviewMessage(
      makeEvent({ frText: '- **FR-4 — Event-driven supervisor.** Body.' }),
    );
    expect(withFr).toContain('Traced requirements (PRD)');
    expect(withFr).toContain('**FR-4 — Event-driven supervisor.**');

    const withoutFr = buildSupervisorReviewMessage(makeEvent());
    expect(withoutFr).not.toContain('Traced requirements (PRD)');
  });

  it('targets ONLY the existing inspect surface — no new endpoint (ac1)', () => {
    const message = buildSupervisorReviewMessage(makeEvent());
    expect(message).toContain('http://localhost:3011/api/specialists/done');
    expect(message).toContain('"specialist":"inspect"');
    expect(message).toContain('"status":"passed"');
    expect(message).toContain('"status":"failed"');
    // No other /api/ path is referenced anywhere in the message.
    const apiPaths = [...message.matchAll(/\/api\/[a-z/-]+/g)].map((m) => m[0]);
    expect(apiPaths.length).toBeGreaterThan(0);
    expect(new Set(apiPaths)).toEqual(new Set(['/api/specialists/done']));
  });

  it('requires the "Bead <beadId>" notes prefix the server extracts the bead id from', () => {
    const message = buildSupervisorReviewMessage(makeEvent());
    // Both verdict payloads carry the prefix, and it satisfies the route's
    // extraction regex at specialists.ts (/[Bb]ead\s+(\S+)/).
    const notesPrefixes = [...message.matchAll(/"notes":"(Bead \S+)/g)].map((m) => m[1]);
    expect(notesPrefixes).toHaveLength(2);
    for (const prefix of notesPrefixes) {
      expect(prefix.match(/[Bb]ead\s+(\S+)/)?.[1]).toBe('pan-9999-3');
    }
  });

  it('states that a blocking finding does not change tracker status (ac2)', () => {
    const message = buildSupervisorReviewMessage(makeEvent());
    expect(message).toContain('does NOT change tracker (Linear/GitHub) status');
    expect(message).toContain('Never run `gh issue close`');
  });
});

describe('deliverCommitForReview', () => {
  it('delivers diff + acceptance criteria to the supervisor via the delivery spy (ac3)', async () => {
    const deliver = vi.fn().mockResolvedValue({ ok: true, path: 'supervisor' });
    const getDiff = vi.fn().mockResolvedValue('diff --git a/x b/x\n+frob');

    const result = await deliverCommitForReview({
      supervisorAgentId: 'supervisor-pan-9999',
      workspacePath: '/tmp/ws',
      issueId: 'PAN-9999',
      item: makeItem(),
      sha: 'abcdef0123456789',
      prdMarkdown: PRD_MARKDOWN,
      apiUrl: 'http://localhost:3011',
      deps: { deliver, getDiff },
    });

    expect(result).toEqual({ ok: true, path: 'supervisor' });
    expect(getDiff).toHaveBeenCalledWith('/tmp/ws', 'abcdef0123456789');
    expect(deliver).toHaveBeenCalledTimes(1);
    const [agentId, message] = deliver.mock.calls[0];
    expect(agentId).toBe('supervisor-pan-9999');
    expect(message).toContain('diff --git a/x b/x');
    expect(message).toContain('The widget renders inside the frobnicator panel');
    expect(message).toContain('Clicking the widget emits a frob event');
    expect(message).toContain('**FR-4 — Event-driven supervisor.**');
    expect(message).toContain('Bead pan-9999-3');
  });

  it('omits FR text when the item has no metadata.traces', async () => {
    const deliver = vi.fn().mockResolvedValue({ ok: true, path: 'tmux' });
    const getDiff = vi.fn().mockResolvedValue('+frob');
    const item = makeItem({ metadata: { difficulty: 'complex' } });

    await deliverCommitForReview({
      supervisorAgentId: 'supervisor-pan-9999',
      workspacePath: '/tmp/ws',
      issueId: 'PAN-9999',
      item,
      sha: 'abcdef0123456789',
      prdMarkdown: PRD_MARKDOWN,
      apiUrl: 'http://localhost:3011',
      deps: { deliver, getDiff },
    });

    const [, message] = deliver.mock.calls[0];
    expect(message).not.toContain('Traced requirements (PRD)');
  });

  it('uses an explicit beadId over the vBRIEF item id when provided', async () => {
    const deliver = vi.fn().mockResolvedValue({ ok: true, path: 'tmux' });
    const getDiff = vi.fn().mockResolvedValue('+frob');

    await deliverCommitForReview({
      supervisorAgentId: 'supervisor-pan-9999',
      workspacePath: '/tmp/ws',
      issueId: 'PAN-9999',
      item: makeItem(),
      sha: 'abcdef0123456789',
      beadId: 'od-1234',
      apiUrl: 'http://localhost:3011',
      deps: { deliver, getDiff },
    });

    const [, message] = deliver.mock.calls[0];
    expect(message).toContain('Bead od-1234');
    expect(message).not.toContain('"notes":"Bead pan-9999-3');
  });
});
