import { describe, expect, it } from 'vitest';
import { loadFixtureDir, readRepoText } from '../../../../evals/lib/fixtures.js';
import {
  extractJsonObject,
  parsePlanQualityCase,
  scorePlanQuality,
} from '../../../../evals/lib/plan-quality-scorer.js';
import { parseXBriefDocument } from '../../../../src/lib/xbrief/io.js';
import { lintPlanQuality } from '../../../../src/lib/xbrief/quality-lint.js';
import type { XBriefDocument, XBriefItem } from '../../../../src/lib/xbrief/types.js';

function item(id: string, files: string[], difficulty: string, kind = 'backend'): XBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    narrative: { Action: `Implement the ${id} change in the named files and cover it with tests` },
    metadata: { files_scope: files, files_scope_confidence: 'high', readiness: 'ready', requiresInspection: false, difficulty, kind },
    items: [
      { id: `${id}.ac1`, title: `${id} returns the parsed value`, status: 'pending', metadata: { kind: 'acceptance_criterion' } },
      { id: `${id}.ac2`, title: `${id} rejects malformed input`, status: 'pending', metadata: { kind: 'acceptance_criterion' } },
    ],
  } as unknown as XBriefItem;
}

function doc(items: XBriefItem[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.8', created: '2026-01-01T00:00:00Z' },
    plan: { id: 'pan-1', title: 'Plan', status: 'proposed', items, edges: [] },
  } as unknown as XBriefDocument;
}

const reference = doc([item('parser', ['src/lib/a.ts'], 'medium'), item('docs', ['docs/A.md'], 'simple', 'docs')]);

describe('evals/lib/plan-quality-scorer', () => {
  describe('extractJsonObject', () => {
    it('returns the object from a ```json fence with prose around it', () => {
      const text = 'Here is the plan:\n```json\n{"plan": {"id": "x"}}\n```\nLet me know.';
      expect(extractJsonObject(text)).toEqual({ plan: { id: 'x' } });
    });

    it('returns the first balanced object from unfenced prose, ignoring braces inside strings', () => {
      expect(extractJsonObject('Plan: {"a": "}{", "b": {"c": 1}} trailing')).toEqual({ a: '}{', b: { c: 1 } });
    });

    it('throws when the text has no JSON object', () => {
      expect(() => extractJsonObject('no json here')).toThrow(/No JSON object found in response/);
    });
  });

  describe('scorePlanQuality', () => {
    it('returns schemaPass 0 and score 0 for output with no JSON object', () => {
      expect(scorePlanQuality('I cannot write files.', reference, '')).toMatchObject({ schemaPass: 0, score: 0 });
    });

    it('returns schemaPass 0 for a JSON object without an xBRIEF envelope or with no items', () => {
      expect(scorePlanQuality('{"plan": {"items": []}}', reference, '').schemaPass).toBe(0);
      expect(scorePlanQuality(JSON.stringify(doc([])), reference, '').schemaPass).toBe(0);
    });

    it('scores the reference document itself as full agreement and lint-clean', () => {
      expect(scorePlanQuality(JSON.stringify(reference), reference, '')).toEqual({
        schemaPass: 1,
        lintErrors: 0,
        lintPass: 1,
        difficultyAgreement: 1,
        fileScopeOverlap: 1,
        itemCountAgreement: 1,
        score: 1,
      });
    });

    it('counts only error-severity lint issues', () => {
      const heavy = item('parser', ['src/lib/a.ts'], 'complex');
      const docsItem = item('docs', ['docs/A.md'], 'simple', 'docs');
      delete (docsItem.metadata as Record<string, unknown>).requiresInspection;
      const model = doc([heavy, docsItem]);
      const issues = lintPlanQuality(model, { prdText: '' });
      expect(issues.filter((i) => i.severity === 'warn')).toHaveLength(1);
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(1);

      expect(scorePlanQuality(JSON.stringify(model), reference, '')).toMatchObject({ schemaPass: 1, lintErrors: 1, lintPass: 0 });
    });

    it('computes difficulty, file-scope and item-count agreement against the reference', () => {
      const model = doc([
        item('parser', ['./src/lib/a.ts'], 'expert'),
        item('extra', ['src/lib/b/**'], 'expert'),
        item('docs', ['docs/A.md'], 'expert', 'docs'),
        item('more', ['src/lib/c.ts'], 'expert'),
      ]);
      const scores = scorePlanQuality(JSON.stringify(model), reference, '');
      // mean rank: model 4, reference 1.5
      expect(scores.difficultyAgreement).toBeCloseTo(1 - 2.5 / 4);
      // {a.ts, b, A.md, c.ts} vs {a.ts, A.md}
      expect(scores.fileScopeOverlap).toBeCloseTo(2 / 4);
      expect(scores.itemCountAgreement).toBeCloseTo(2 / 4);
    });
  });

  describe('parsePlanQualityCase', () => {
    const valid = {
      id: 'pan-1',
      issueId: 'PAN-1',
      issueState: 'CLOSED',
      title: 'T',
      url: 'https://github.com/eltmon/overdeck/issues/1',
      body: 'Body',
      prdPath: '.pan/drafts/pan-1.md',
      referenceSpecPath: '.pan/specs/2026-01-01-PAN-1-x.xbrief.json',
    };

    it('accepts a valid case and rejects an open issue', () => {
      expect(parsePlanQualityCase(valid).issueId).toBe('PAN-1');
      expect(() => parsePlanQualityCase({ ...valid, issueState: 'OPEN' })).toThrow(/CLOSED/);
    });
  });

  describe('committed fixtures', () => {
    const cases = loadFixtureDir('evals/fixtures/plan-quality').map((f) => parsePlanQualityCase(f.data));

    it('holds exactly 8 closed-issue cases', () => {
      expect(cases).toHaveLength(8);
      for (const c of cases) expect(c.issueState).toBe('CLOSED');
    });

    it('points each case at a reference spec parseXBriefDocument accepts and a readable PRD', () => {
      for (const c of cases) {
        const reference = parseXBriefDocument(readRepoText(c.referenceSpecPath), c.referenceSpecPath);
        expect(reference.plan.items.length, c.id).toBeGreaterThanOrEqual(3);
        expect(reference.plan.items.length, c.id).toBeLessThanOrEqual(20);
        expect(readRepoText(c.prdPath).length, c.id).toBeGreaterThan(0);
      }
    });
  });
});
