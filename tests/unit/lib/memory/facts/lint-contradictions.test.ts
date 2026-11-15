import { describe, expect, it, vi } from 'vitest';
import type { MemoryExtractionPolicyResult } from '../../../../../src/lib/memory/providers/policy.js';
import type { MemoryFact } from '../../../../../src/lib/memory/facts/store.js';
import {
  buildContradictionPrompt,
  CONTRADICTION_JSON_SCHEMA,
  type ContradictionJudge,
  judgeContradictions,
  MAX_CONTRADICTION_PAIRS,
} from '../../../../../src/lib/memory/facts/lint-contradictions.js';

function fact(id: string, description: string, body = ''): MemoryFact {
  return {
    id,
    scope: 'project',
    type: 'project',
    title: id,
    description,
    tags: [],
    created: null,
    updated: null,
    source: null,
    status: 'active',
    supersedes: [],
    supersededBy: null,
    review: [],
    extra: {},
    body,
    file: `/repo/.overdeck/memory/${id}.md`,
  };
}

function extracted(data: unknown): MemoryExtractionPolicyResult<unknown> {
  return {
    status: 'extracted',
    provider: 'fake-provider',
    result: {
      data,
      model: 'fake-model',
      usage: { prompt: 0, completion: 0, total: 0 },
      cost: { usd: 0 },
    } as never,
  };
}

function factMap(facts: MemoryFact[]): Map<string, MemoryFact> {
  return new Map(facts.map((entry) => [entry.id, entry]));
}

/** "<fact A id>/<fact B id>" for a prompt built by buildContradictionPrompt. */
function promptPair(prompt: string): string {
  const ids = [...prompt.matchAll(/\(id ([a-z0-9-]+),/g)].map((match) => match[1]);
  return ids.join('/');
}

describe('judgeContradictions', () => {
  const enable = fact('enable-timestream', 'Enable timestream during sieges.');
  const disable = fact('disable-timestream', 'Disable timestream during sieges.');
  const other = fact('noble-rooms', 'Every noble gets four rooms.');

  it('reports a seeded contradiction from the injected judge', async () => {
    const judge: ContradictionJudge = vi.fn(async (prompt: string) => (
      promptPair(prompt) === 'disable-timestream/enable-timestream'
        ? extracted({ contradicts: true, reason: 'One enables timestream, the other disables it.' })
        : extracted({ contradicts: false, reason: 'Unrelated.' })
    ));

    const report = await judgeContradictions({
      facts: factMap([enable, disable, other]),
      candidates: [
        { a: 'disable-timestream', b: 'enable-timestream', score: 0.9 },
        { a: 'enable-timestream', b: 'noble-rooms', score: 0.4 },
      ],
      judge,
    });

    expect(report).toEqual({
      status: 'checked',
      provider: 'fake-provider',
      model: 'fake-model',
      pairsChecked: 2,
      pairsFailed: 0,
      findings: [{ a: 'disable-timestream', b: 'enable-timestream', reason: 'One enables timestream, the other disables it.' }],
    });
    expect(judge).toHaveBeenCalledWith(expect.any(String), CONTRADICTION_JSON_SCHEMA);
  });

  it('stops with status unavailable when the first call is dropped', async () => {
    const judge = vi.fn<ContradictionJudge>(async () => ({
      status: 'dropped',
      reason: 'extraction-failed',
      error: new Error('no API key'),
    }));

    const report = await judgeContradictions({
      facts: factMap([enable, disable, other]),
      candidates: [
        { a: 'disable-timestream', b: 'enable-timestream', score: 0.9 },
        { a: 'enable-timestream', b: 'noble-rooms', score: 0.4 },
      ],
      judge,
    });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('unavailable');
    expect(report.reason).toBe('extraction-failed: no API key');
    expect(report.findings).toEqual([]);
  });

  it('stops with status unavailable and the cost-cap reason when the first call is skipped', async () => {
    const judge = vi.fn<ContradictionJudge>(async () => ({ status: 'skipped', reason: 'cost-cap' }));
    const report = await judgeContradictions({
      facts: factMap([enable, disable]),
      candidates: [{ a: 'disable-timestream', b: 'enable-timestream', score: 0.9 }],
      judge,
    });
    expect(report).toMatchObject({ status: 'unavailable', reason: 'cost-cap' });
  });

  it('checks at most maxPairs pairs, most similar first', async () => {
    const facts = Array.from({ length: 31 }, (_, index) => fact(`fact-${String(index).padStart(2, '0')}`, `Fact ${index}.`));
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      a: facts[index].id,
      b: facts[index + 1].id,
      score: (index + 1) / 100,
    }));
    const seen: string[] = [];
    const judge: ContradictionJudge = async (prompt) => {
      seen.push(promptPair(prompt));
      return extracted({ contradicts: false, reason: 'fine' });
    };

    const report = await judgeContradictions({ facts: factMap(facts), candidates, judge, maxPairs: 20 });

    expect(report.pairsChecked).toBe(20);
    const expected = [...candidates].sort((x, y) => y.score - x.score).slice(0, 20).map((pair) => `${pair.a}/${pair.b}`);
    expect(seen).toEqual(expected);
    expect(MAX_CONTRADICTION_PAIRS).toBe(20);
  });

  it('counts a malformed answer in pairsFailed and continues', async () => {
    const answers = [extracted({ reason: 'no boolean here' }), extracted({ contradicts: true, reason: 'Conflict.' })];
    const judge = vi.fn<ContradictionJudge>(async () => answers.shift() as MemoryExtractionPolicyResult<unknown>);

    const report = await judgeContradictions({
      facts: factMap([enable, disable, other]),
      candidates: [
        { a: 'disable-timestream', b: 'enable-timestream', score: 0.9 },
        { a: 'enable-timestream', b: 'noble-rooms', score: 0.4 },
      ],
      judge,
    });

    expect(judge).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ status: 'checked', pairsChecked: 2, pairsFailed: 1 });
    expect(report.findings).toEqual([{ a: 'enable-timestream', b: 'noble-rooms', reason: 'Conflict.' }]);
  });

  it('truncates each fact body to 2,000 characters in the prompt', () => {
    const prompt = buildContradictionPrompt(fact('long-a', 'Long.', 'y'.repeat(5000)), fact('short-b', 'Short.', 'Body.'));
    expect(prompt).toContain(`${'y'.repeat(2000)}…`);
    expect(prompt).not.toContain('y'.repeat(2001));
    expect(prompt).toContain('(id short-b, type project)');
  });
});
