import { describe, expect, it } from 'vitest';
import { loadFixtureDir } from '../../../../evals/lib/fixtures.js';
import {
  decoyViolations,
  extractIdentifiers,
  factRecalled,
  parseSummaryCase,
  parseTitleOutput,
  plantedRecall,
  scoreFaithfulness,
  titleFormatValid,
  unsupportedIdentifiers,
  type SummaryCase,
} from '../../../../evals/lib/faithfulness-scorer.js';
import { serializeConversation } from '../../../../src/lib/conversations/smart-compaction.js';

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
      const ids = extractIdentifiers('See ~/notes/plan.md and src/lib/a.ts for PAN-12 at 3f9ab21c; call `drainAll`. UTF-8 is fine.');
      expect(ids).toEqual(expect.arrayContaining(['~/notes/plan.md', 'src/lib/a.ts', 'PAN-12', '3f9ab21c', 'drainAll']));
      expect(ids).not.toContain('UTF-8');
    });

    it('treats only single-token backticked spans as identifiers', () => {
      expect(extractIdentifiers('Run `npm run build` and set `overflow: hidden` on `document.body`.')).toEqual(['document.body']);
    });

    it('ignores all-letter or all-digit hex-like tokens', () => {
      expect(extractIdentifiers('deadbeef and 12345678 are not SHAs')).toEqual([]);
    });
  });

  it('unsupportedIdentifiers matches issue ids case-insensitively', () => {
    expect(unsupportedIdentifiers('Work on PAN-4245 continues.', 'cd workspaces/feature-pan-4245')).toEqual([]);
    expect(unsupportedIdentifiers('See Src/Lib/A.ts', 'src/lib/a.ts')).toEqual(['Src/Lib/A.ts']);
  });

  it('unsupportedIdentifiers lists identifiers absent from the source', () => {
    expect(unsupportedIdentifiers('Fixed src/lib/server/port.ts and src/lib/server/other.ts for PAN-4101', SOURCE)).toEqual([
      'src/lib/server/other.ts',
    ]);
  });

  // The cases below are the PAN-4406 run's captured false positives (Opus/Sonnet 5.5 compaction and handoff summaries).
  describe('elided identifiers and dot-directories (PAN-4406)', () => {
    it('extracts a dot-directory path once, with its dot', () => {
      for (const summary of [
        'Wrote `.pan/specs/2026-09-27-PAN-4263-...xbrief.json` for the plan.',
        'Wrote .pan/specs/2026-09-27-PAN-4263-...xbrief.json for the plan.',
      ]) {
        const ids = extractIdentifiers(summary);
        expect(ids).toContain('.pan/specs/2026-09-27-PAN-4263-...xbrief.json');
        expect(ids.filter((id) => id.startsWith('pan/'))).toEqual([]);
      }
      expect(extractIdentifiers('see .pan/specs/a.xbrief.json')).toEqual(['.pan/specs/a.xbrief.json']);
    });

    it('supports an elided identifier whose fragments occur in the source in order', () => {
      const cases: Array<[string, string]> = [
        ['Output in `.../tasks/brdyp4ckx.output`.', 'Wrote /tmp/claude-1000/-home-x/abc/tasks/brdyp4ckx.output'],
        ['Read `/tmp/claude-1000/.../tasks/<id>.output` next.', 'Wrote /tmp/claude-1000/-home-x/abc/tasks/b19msud0w.output'],
        ['Spec at .pan/specs/2026-09-27-PAN-4263-...xbrief.json', 'git add .pan/specs/2026-09-27-PAN-4263-open-pr-selector.xbrief.json'],
        ['Spec at `.pan/specs/…PAN-4268…` is final.', 'git add .pan/specs/2026-09-28-PAN-4268-ensure-main.xbrief.json'],
      ];
      for (const [summary, source] of cases) expect(unsupportedIdentifiers(summary, source)).toEqual([]);
    });

    it('keeps invented paths unsupported', () => {
      expect(unsupportedIdentifiers('Added src/lib/github-pr-select.ts.', 'Edited src/lib/github.ts')).toEqual([
        'src/lib/github-pr-select.ts',
      ]);
    });

    it('rejects an elided identifier whose fragments occur out of order', () => {
      expect(unsupportedIdentifiers('See `/tasks/.../tmp/x.output`.', 'Wrote /tmp/a/tasks/b.output')).toEqual([
        '/tasks/.../tmp/x.output',
      ]);
      // Both fragments occur in the source, but /tmp/a only before /tasks/.
      expect(unsupportedIdentifiers('See `/tasks/.../tmp/a`.', 'Wrote /tmp/a/tasks/b.output')).toEqual(['/tasks/.../tmp/a']);
    });
  });

  describe('decoyViolations', () => {
    it('flags an anchor stated as current', () => {
      expect(decoyViolations('The dashboard now runs on port 4000.', summaryCase().decoys)).toEqual(['old-port']);
    });

    it('accepts an anchor whose sentence says instead or rejected', () => {
      expect(decoyViolations('It uses 4011 instead of port 4000.', summaryCase().decoys)).toEqual([]);
      expect(decoyViolations('Port 4000 was rejected. The server uses 4011.', summaryCase().decoys)).toEqual([]);
    });

    it('accepts an anchor whose sentence says rather than or changed', () => {
      expect(decoyViolations('It listens on 4011 rather than port 4000.', summaryCase().decoys)).toEqual([]);
      expect(decoyViolations('An early build used port 4000; it was changed to 4011.', summaryCase().decoys)).toEqual([]);
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

  describe('committed fixtures', () => {
    const fixtures = loadFixtureDir('evals/fixtures/summaries');
    const cases = fixtures.map((f) => parseSummaryCase(f.data));

    it('holds 10 cases: 3 fork, 3 compaction, 2 handoff, 2 title', () => {
      const count = (kind: SummaryCase['kind']) => cases.filter((c) => c.kind === kind).length;
      expect(cases).toHaveLength(10);
      expect([count('fork'), count('compaction'), count('handoff'), count('title')]).toEqual([3, 3, 2, 2]);
    });

    it('keeps each source within 40 entries and 60,000 serialized chars, with no home path', () => {
      for (const c of cases) {
        expect(c.entries.length, c.id).toBeLessThanOrEqual(40);
        expect(serializeConversation(c.entries, false).length, c.id).toBeLessThanOrEqual(60_000);
        expect(JSON.stringify(c), c.id).not.toContain('/home/');
      }
    });

    it('plants every fact in the serialized source', () => {
      for (const c of cases) {
        const source = serializeConversation(c.entries, false);
        for (const fact of c.plantedFacts) expect(factRecalled(source, fact), `${c.id}/${fact.id}`).toBe(true);
      }
    });

    it('states every decoy in the source only as retracted', () => {
      for (const c of cases) {
        const source = serializeConversation(c.entries, false);
        for (const decoy of c.decoys) {
          expect(source.toLowerCase(), `${c.id}/${decoy.id}`).toContain(decoy.anchor.toLowerCase());
          expect(decoyViolations(source, [decoy]), `${c.id}/${decoy.id}`).toEqual([]);
        }
      }
    });
  });
});
