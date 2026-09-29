import { describe, expect, it } from 'vitest';

import {
  answeredCritiqueTitles,
  evaluateCritiqueGate,
  isFlaggedByLabels,
  parseCritique,
  withUnresolvedSection,
  type CritiqueGateInput,
  type ParsedCritique,
} from '../plan-critique.js';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);

function critique(body: string, digest = DIGEST): ParsedCritique {
  return parseCritique(`plan-digest: ${digest}\n\n${body}`);
}

const BLOCKING = critique(
  [
    '## blocks-the-design: Digest ignores item order',
    'evidence',
    '## sharpens-framing: Name the helper',
    '## footnote: Typo in glossary',
  ].join('\n'),
);

function gate(overrides: Partial<CritiqueGateInput>): ReturnType<typeof evaluateCritiqueGate> {
  return evaluateCritiqueGate({
    required: true,
    currentDigest: DIGEST,
    roundsUsed: 1,
    latest: { round: 1, critique: BLOCKING },
    prdText: '# PRD\n',
    ...overrides,
  });
}

describe('parseCritique', () => {
  it('reads the digest line and the classified findings', () => {
    expect(BLOCKING.digest).toBe(DIGEST);
    expect(BLOCKING.findings).toEqual([
      { classification: 'blocks-the-design', title: 'Digest ignores item order' },
      { classification: 'sharpens-framing', title: 'Name the helper' },
      { classification: 'footnote', title: 'Typo in glossary' },
    ]);
  });

  it('ignores other level-2 headings and returns a null digest for a malformed first line', () => {
    const parsed = parseCritique('plan-digest: NOTHEX\n\n## Summary\n## blocks-the-design:   Trimmed title  \n');
    expect(parsed.digest).toBeNull();
    expect(parsed.findings).toEqual([{ classification: 'blocks-the-design', title: 'Trimmed title' }]);
  });
});

describe('answeredCritiqueTitles', () => {
  it('collects trimmed, lower-cased ### titles only inside ## Critique response', () => {
    const prd = [
      '# PRD',
      '### Outside the section',
      '## Critique response',
      '###   Digest Ignores Item ORDER  ',
      'answer text',
      '## Next section',
      '### Also outside',
    ].join('\n');
    expect([...answeredCritiqueTitles(prd)]).toEqual(['digest ignores item order']);
  });

  it('returns an empty set without the section', () => {
    expect(answeredCritiqueTitles('# PRD\n### Digest ignores item order\n').size).toBe(0);
  });
});

describe('isFlaggedByLabels', () => {
  it('matches the three critic labels case-insensitively', () => {
    expect(isFlaggedByLabels(['Security'])).toBe(true);
    expect(isFlaggedByLabels(['enhancement', 'architecture'])).toBe(true);
    expect(isFlaggedByLabels(['SUBSTRATE-IMPROVEMENT'])).toBe(true);
    expect(isFlaggedByLabels(['enhancement', 'security-ish'])).toBe(false);
  });
});

describe('evaluateCritiqueGate', () => {
  it('(a) passes not-required when the plan is not flagged', () => {
    expect(gate({ required: false, roundsUsed: 0, latest: null })).toEqual({ ok: true, kind: 'not-required' });
  });

  it('(b) passes cap-reached after two rounds and lists unanswered blocking titles', () => {
    expect(gate({ roundsUsed: 2, currentDigest: OTHER_DIGEST, latest: { round: 2, critique: BLOCKING } })).toEqual({
      ok: true,
      kind: 'cap-reached',
      unresolved: ['Digest ignores item order'],
    });
  });

  it('(c) refuses missing for round 1 when no round was used', () => {
    const result = gate({ roundsUsed: 0, latest: null });
    expect(result).toMatchObject({ ok: false, kind: 'missing', nextRound: 1 });
  });

  it('(c) refuses missing when the latest used round has no file in the tree', () => {
    expect(gate({ roundsUsed: 1, latest: null })).toMatchObject({ ok: false, kind: 'missing', nextRound: 2 });
  });

  it('(d) refuses stale when the critique digest differs from the current draft', () => {
    expect(gate({ currentDigest: OTHER_DIGEST })).toMatchObject({ ok: false, kind: 'stale', nextRound: 2 });
  });

  it('(d) treats a malformed digest line as stale', () => {
    const malformed = parseCritique('no digest here\n## blocks-the-design: X\n');
    expect(gate({ latest: { round: 1, critique: malformed } })).toMatchObject({ ok: false, kind: 'stale' });
  });

  it('(e) refuses unanswered blocking findings and names them', () => {
    const result = gate({});
    expect(result).toMatchObject({ ok: false, kind: 'unanswered', titles: ['Digest ignores item order'] });
    if (!result.ok) expect(result.reason).toContain('Digest ignores item order');
  });

  it('(f) passes answered when every blocking finding has a ### heading, case-insensitively', () => {
    const prdText = '# PRD\n\n## Critique response\n\n### digest ignores ITEM order \n\nFixed.\n';
    expect(gate({ prdText })).toEqual({ ok: true, kind: 'answered' });
  });

  it('never blocks on sharpens-framing or footnote findings', () => {
    const soft = critique('## sharpens-framing: A\n## footnote: B\n');
    expect(gate({ latest: { round: 1, critique: soft }, prdText: null })).toEqual({ ok: true, kind: 'answered' });
  });
});

describe('withUnresolvedSection', () => {
  it('creates the Critique response heading when absent', () => {
    const out = withUnresolvedSection('# PRD\n\nBody.\n', ['First', 'Second']);
    expect(out).toBe(
      '# PRD\n\nBody.\n\n## Critique response\n\n### Unresolved after two critic rounds\n\n- First\n- Second\n',
    );
  });

  it('is idempotent and replaces an existing subsection', () => {
    const prd = '# PRD\n\n## Critique response\n\n### Answered one\n\nYes.\n\n## Appendix\n\nText.\n';
    const once = withUnresolvedSection(prd, ['First']);
    expect(withUnresolvedSection(once, ['First'])).toBe(once);
    expect(once).toContain('### Answered one\n\nYes.\n\n### Unresolved after two critic rounds\n\n- First\n\n## Appendix');

    const replaced = withUnresolvedSection(once, ['Second']);
    expect(replaced).toContain('- Second');
    expect(replaced).not.toContain('- First');
    expect(withUnresolvedSection(replaced, ['Second'])).toBe(replaced);
  });

  it('is idempotent when the section is last in the file', () => {
    const once = withUnresolvedSection('# PRD\n\n## Critique response\n\n### A\n', ['X']);
    expect(withUnresolvedSection(once, ['X'])).toBe(once);
  });
});
