import { describe, expect, it } from 'vitest';
import {
  decoyViolations,
  extractIdentifiers,
  parseSummaryCase,
  parseTitleOutput,
  plantedRecall,
  scoreFaithfulness,
  titleFormatValid,
  unsupportedIdentifiers,
  type SummaryCase,
} from '../../../../evals/lib/faithfulness-scorer.js';

const SOURCE = [
  'USER: the dashboard fails to start on port 4000.',
  'ASSISTANT: We tried port 4000 but switched to port 4011 because 4000 collides with Vite.',
  'Edited src/lib/server/port.ts and ran `npm run build`. Commit 3f9ab21c fixes PAN-4101.',
].join('\n\n');

function summaryCase(overrides: Partial<SummaryCase> = {}): SummaryCase {
  return {
    id: 'fork-port',
    kind: 'fork',
    source: 'synthetic',
    entries: [{ type: 'user', message: { content: 'hi' } }],
    plantedFacts: [
      { id: 'port', anyOf: [['4011']] },
      { id: 'file', anyOf: [['port.ts'], ['src/lib/server']] },
    ],
    decoys: [{ id: 'old-port', anchor: 'port 4000' }],
    ...overrides,
  };
}

describe('evals/lib/faithfulness-scorer', () => {
  describe('extractIdentifiers', () => {
    it('extracts paths, issue ids, SHAs and backticked identifiers', () => {
      const ids = extractIdentifiers('See ~/notes/plan.md and src/lib/a.ts for PAN-12 at 3f9ab21c; run `pan done`. UTF-8 is fine.');
      expect(ids).toEqual(expect.arrayContaining(['~/notes/plan.md', 'src/lib/a.ts', 'PAN-12', '3f9ab21c', 'pan done']));
      expect(ids).not.toContain('UTF-8');
    });

    it('ignores all-letter or all-digit hex-like tokens', () => {
      expect(extractIdentifiers('deadbeef and 12345678 are not SHAs')).toEqual([]);
    });
  });

  it('unsupportedIdentifiers lists identifiers absent from the source', () => {
    expect(unsupportedIdentifiers('Fixed src/lib/server/port.ts and src/lib/server/other.ts for PAN-4101', SOURCE)).toEqual([
      'src/lib/server/other.ts',
    ]);
  });

  describe('decoyViolations', () => {
    it('flags an anchor stated as current', () => {
      expect(decoyViolations('The dashboard now runs on port 4000.', summaryCase().decoys)).toEqual(['old-port']);
    });

    it('accepts an anchor whose sentence says instead or rejected', () => {
      expect(decoyViolations('It uses 4011 instead of port 4000.', summaryCase().decoys)).toEqual([]);
      expect(decoyViolations('Port 4000 was rejected. The server uses 4011.', summaryCase().decoys)).toEqual([]);
    });
  });

  it('plantedRecall counts a fact when every term of one alternative occurs', () => {
    expect(plantedRecall('Moved to 4011 in SRC/LIB/SERVER.', summaryCase().plantedFacts)).toBe(1);
    expect(plantedRecall('Moved to 4011.', summaryCase().plantedFacts)).toBe(0.5);
  });

  describe('titles', () => {
    it('titleFormatValid rejects a 2-word title and a trailing period, and accepts 3-8 plain words', () => {
      expect(titleFormatValid('Fix port')).toBe(false);
      expect(titleFormatValid('Fix dashboard port collision.')).toBe(false);
      expect(titleFormatValid('"Fix dashboard port collision"')).toBe(false);
      expect(titleFormatValid('Fix dashboard port collision')).toBe(true);
    });

    it('parseTitleOutput reads {"title": ...} JSON, else the first non-empty line', () => {
      expect(parseTitleOutput('{"title": "Move dashboard to port 4011"}')).toBe('Move dashboard to port 4011');
      expect(parseTitleOutput('```json\n{"title": "Move dashboard to port 4011"}\n```')).toBe('Move dashboard to port 4011');
      expect(parseTitleOutput('\n  Move dashboard to port 4011\nmore')).toBe('Move dashboard to port 4011');
    });
  });

  describe('scoreFaithfulness', () => {
    it('hard-fails a compaction summary that names a file absent from the source', () => {
      const scores = scoreFaithfulness('Port 4011 set in src/lib/server/port.ts and src/lib/missing.ts.', summaryCase({ kind: 'compaction' }), SOURCE);
      expect(scores).toMatchObject({ unsupported: 1, decoyHits: 0, score: 0, formatValid: null });
    });

    it('halves a fork summary with full recall and one decoy stated as current', () => {
      const scores = scoreFaithfulness('The server in src/lib/server/port.ts listens on port 4000. Also 4011 is configured.', summaryCase(), SOURCE);
      expect(scores).toMatchObject({ recall: 1, decoyHits: 1, unsupported: 0, hallucinations: 1, score: 0.5 });
    });

    it('scores a clean handoff at its recall', () => {
      const scores = scoreFaithfulness('Switched from port 4000 to 4011 in port.ts.', summaryCase({ kind: 'handoff', focus: 'port' }), SOURCE);
      expect(scores).toMatchObject({ recall: 1, hallucinations: 0, score: 1 });
    });

    it('zeroes a title with an invalid format and scores a valid one by recall', () => {
      const titleCase = summaryCase({ kind: 'title', plantedFacts: [{ id: 'port', anyOf: [['4011']] }] });
      expect(scoreFaithfulness('{"title": "Port 4011."}', titleCase, SOURCE)).toMatchObject({ formatValid: 0, score: 0 });
      expect(scoreFaithfulness('{"title": "Move dashboard to port 4011"}', titleCase, SOURCE)).toMatchObject({ formatValid: 1, score: 1 });
    });
  });

  describe('parseSummaryCase', () => {
    it('accepts a valid case and rejects a handoff without focus', () => {
      expect(parseSummaryCase(summaryCase()).id).toBe('fork-port');
      expect(() => parseSummaryCase(summaryCase({ kind: 'handoff' }))).toThrow(/needs a focus/);
    });
  });
});
