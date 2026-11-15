import { describe, expect, it } from 'vitest';
import {
  FACT_RETRIEVAL_LIMIT,
  rankFactsForQuery,
  tokenizeForFacts,
} from '../../../../../src/lib/memory/facts/rank.js';
import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';

function makeFact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    scope: 'project',
    type: 'project',
    title: '',
    description: '',
    tags: [],
    updated: null,
    source: null,
    review: [],
    body: '',
    file: `/facts/${overrides.id}.md`,
    ...overrides,
  };
}

describe('tokenizeForFacts', () => {
  it('normalises inflected forms to the same stem', () => {
    expect(tokenizeForFacts('reconnect reconnecting')).toEqual(['reconnect', 'reconnect']);
    expect(tokenizeForFacts('merge merges merged merging')).toEqual(['merg', 'merg', 'merg', 'merg']);
    expect(tokenizeForFacts('cache caches cached')).toEqual(['cach', 'cach', 'cach']);
    expect(tokenizeForFacts('issue issues')).toEqual(['issu', 'issu']);
  });

  it('drops tokens shorter than 3 characters', () => {
    expect(tokenizeForFacts('a to it merge')).toEqual(['merg']);
  });
});

describe('rankFactsForQuery', () => {
  it('ranks a fact whose description names the query topic first', () => {
    const target = makeFact({
      id: 'octopus-integration',
      title: 'Octopus integration notes',
      description: 'Describes the octopus integration workflow end to end',
    });
    const unrelated = makeFact({
      id: 'unrelated-fact',
      title: 'Totally unrelated topic',
      description: 'Nothing to do with the query at all',
      body: 'More unrelated filler content padding the body.',
    });
    const ranked = rankFactsForQuery({
      facts: [unrelated, target],
      query: 'need help with the octopus integration',
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.fact.id).toBe('octopus-integration');
  });

  it('returns no facts for a query whose terms appear in no fact', () => {
    const facts = [
      makeFact({ id: 'fact-one', title: 'Something else entirely' }),
      makeFact({ id: 'fact-two', title: 'Another unrelated subject' }),
    ];
    expect(rankFactsForQuery({ facts, query: 'completely nonexistent topic words' })).toEqual([]);
  });

  it('weights id, title, description and tags above body', () => {
    const headMatch = makeFact({
      id: 'nimbus-head-fact',
      title: 'Nimbus token handling',
      body: 'No further mentions in the body of this fact.',
    });
    const bodyOnlyMatch = makeFact({
      id: 'unrelated-body-fact',
      title: 'Totally different subject',
      body: 'This fact only mentions nimbus once inside the body text.',
    });
    const ranked = rankFactsForQuery({ facts: [headMatch, bodyOnlyMatch], query: 'nimbus' });
    const ids = ranked.map((r) => r.fact.id);
    expect(ids).toContain('nimbus-head-fact');
    expect(ids).not.toContain('unrelated-body-fact');
  });

  it("rejects a short two-word prompt's facts unless the head names both words", () => {
    const factBoth = makeFact({ id: 'both-commit-push', title: 'commit and push workflow' });
    const commitOnly = Array.from({ length: 7 }, (_, i) =>
      makeFact({ id: `commit-only-${i}`, title: 'commit workflow notes' }),
    );
    const pushOnly = Array.from({ length: 7 }, (_, i) =>
      makeFact({ id: `push-only-${i}`, title: 'push workflow notes' }),
    );
    const filler = Array.from({ length: 5 }, (_, i) =>
      makeFact({ id: `filler-${i}`, title: 'lorem ipsum dolor sit amet' }),
    );
    const facts = [factBoth, ...commitOnly, ...pushOnly, ...filler];
    const ranked = rankFactsForQuery({ facts, query: 'commit and push' });
    const ids = ranked.map((r) => r.fact.id);
    expect(ids).toEqual(['both-commit-push']);
  });

  it('ignores stopwords and terms present in more than half the facts', () => {
    const majority = Array.from({ length: 8 }, (_, i) =>
      makeFact({ id: `majority-${i}`, title: 'common marker fact' }),
    );
    const minority = Array.from({ length: 2 }, (_, i) =>
      makeFact({ id: `minority-${i}`, title: 'something else entirely' }),
    );
    const facts = [...majority, ...minority];
    expect(rankFactsForQuery({ facts, query: 'the common marker' })).toEqual([]);
  });

  it('ranks against topic words that appear after the first 12 words of the prompt', () => {
    const target = makeFact({ id: 'zylofoo-fact', title: 'zylofoo configuration notes' });
    const other = makeFact({
      id: 'other-fact',
      title: 'other fact about something else',
      body: 'nothing related here at all whatsoever',
    });
    const padding = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    expect(padding.split(' ')).toHaveLength(12);
    const ranked = rankFactsForQuery({ facts: [target, other], query: `${padding} zylofoo` });
    expect(ranked.map((r) => r.fact.id)).toContain('zylofoo-fact');
  });

  it('caps the result at FACT_RETRIEVAL_LIMIT', () => {
    const facts = Array.from({ length: 8 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return makeFact({ id: `fact-${n}`, title: `uniqueword${n} topic marker` });
    });
    const query = facts.map((_, i) => `uniqueword${String(i + 1).padStart(2, '0')}`).join(' ');
    const ranked = rankFactsForQuery({ facts, query });
    expect(ranked).toHaveLength(FACT_RETRIEVAL_LIMIT);
  });

  it('returns [] for an empty fact list, an empty query, or a stopword-only query', () => {
    const facts = [makeFact({ id: 'some-fact', title: 'some fact title' })];
    expect(rankFactsForQuery({ facts: [], query: 'anything' })).toEqual([]);
    expect(rankFactsForQuery({ facts, query: '' })).toEqual([]);
    expect(rankFactsForQuery({ facts, query: 'the and but' })).toEqual([]);
  });

  it('respects a caller-supplied limit', () => {
    const facts = Array.from({ length: 4 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return makeFact({ id: `fact-${n}`, title: `uniqueword${n} topic marker` });
    });
    const query = facts.map((_, i) => `uniqueword${String(i + 1).padStart(2, '0')}`).join(' ');
    const ranked = rankFactsForQuery({ facts, query, limit: 2 });
    expect(ranked).toHaveLength(2);
  });

  describe('200-fact fixture', () => {
    function buildFixture(): MemoryFact[] {
      const commonOnly = makeFact({ id: 'widget-common-fact', title: 'widgetcommon marker' });
      const commonGroup = Array.from({ length: 19 }, (_, i) =>
        makeFact({ id: `widgetcommon-filler-${i}`, title: 'widgetcommon' }),
      );
      const rareFact = makeFact({ id: 'elevenlabs-fact', title: 'elevenlabs voice setup' });
      const filler = Array.from({ length: 179 }, (_, i) =>
        makeFact({
          id: `filler-fact-${i}`,
          title: `lorem ipsum dolor sit amet consectetur ${i}`,
          body: 'padding content unrelated to the query terms used in this fixture',
        }),
      );
      return [commonOnly, ...commonGroup, rareFact, ...filler];
    }

    it('rejects a fact whose head shares only one common (df 20) term with the query', () => {
      const facts = buildFixture();
      const padding = 'please help me understand how this thing works across these modules during';
      expect(padding.split(' ')).toHaveLength(12);
      const ranked = rankFactsForQuery({ facts, query: `${padding} widgetcommon` });
      expect(ranked.map((r) => r.fact.id)).not.toContain('widget-common-fact');
    });

    it('admits a fact whose head holds one rare query term inside a 400-word prompt', () => {
      const facts = buildFixture();
      const padding = Array.from({ length: 50 }, (_, i) => `paddingword${i}`).join(' ');
      const ranked = rankFactsForQuery({ facts, query: `${padding} elevenlabs integration setup` });
      expect(ranked.map((r) => r.fact.id)).toContain('elevenlabs-fact');
    });
  });
});
