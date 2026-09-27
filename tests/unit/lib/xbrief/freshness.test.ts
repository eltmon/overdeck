import { describe, expect, it } from 'vitest';
import { checkPlanFreshness, formatPlanFreshnessRefusal, isDriftedPath, planCreatedEpoch } from '../../../../src/lib/xbrief/freshness.js';
import type { XBriefDocument, XBriefItemStatus } from '../../../../src/lib/xbrief/types.js';

function makeDoc(items: Array<{ id: string; status?: XBriefItemStatus; files_scope?: string[] }>, created?: string): XBriefDocument {
  return {
    xBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-1',
      title: 'Test Plan',
      status: 'approved',
      created,
      items: items.map((item) => ({
        id: item.id,
        title: item.id,
        status: item.status ?? 'pending',
        metadata: { files_scope: item.files_scope },
      })),
      edges: [],
    },
  };
}

describe('checkPlanFreshness', () => {
  it('reports no missing files when every declared path exists', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/foo.ts', 'src/bar.ts'] }]);
    const result = checkPlanFreshness(doc, '/ws', () => true);
    expect(result).toEqual({ missing: [], checked: 2 });
  });

  it('reports paths that do not exist', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/foo.ts', 'src/gone.ts'] }]);
    const result = checkPlanFreshness(doc, '/ws', (path) => path.endsWith('foo.ts'));
    expect(result.missing).toEqual(['src/gone.ts']);
    expect(result.checked).toBe(2);
  });

  it('resolves each files_scope entry relative to the workspace root', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/foo.ts'] }]);
    const seen: string[] = [];
    checkPlanFreshness(doc, '/ws/feature-pan-1', (path) => {
      seen.push(path);
      return true;
    });
    expect(seen).toEqual(['/ws/feature-pan-1/src/foo.ts']);
  });

  it('ignores glob entries (*, ?, {)', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/**/*.ts', 'src/foo?.ts', 'src/{a,b}.ts', 'src/real.ts'] }]);
    const result = checkPlanFreshness(doc, '/ws', () => false);
    // Only the one concrete, non-glob entry is checked (and reported missing).
    expect(result.checked).toBe(1);
    expect(result.missing).toEqual(['src/real.ts']);
  });

  it('de-duplicates a files_scope entry repeated across items', () => {
    const doc = makeDoc([
      { id: 'a', files_scope: ['src/shared.ts'] },
      { id: 'b', files_scope: ['src/shared.ts'] },
    ]);
    const result = checkPlanFreshness(doc, '/ws', () => false);
    expect(result.checked).toBe(1);
    expect(result.missing).toEqual(['src/shared.ts']);
  });

  it('treats an item with no files_scope as contributing nothing', () => {
    const doc = makeDoc([{ id: 'a' }]);
    const result = checkPlanFreshness(doc, '/ws', () => false);
    expect(result).toEqual({ missing: [], checked: 0 });
  });

  it('is a pure function — it never calls the filesystem directly, only existsFn', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/foo.ts'] }]);
    let calls = 0;
    checkPlanFreshness(doc, '/ws', () => { calls += 1; return true; });
    expect(calls).toBe(1);
  });

  it('does not report a missing path whose probe returns null, but still counts it', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/created.ts'] }], '2026-09-20T00:00:00Z');
    const result = checkPlanFreshness(doc, '/ws', () => false, () => null);
    expect(result.missing).toEqual([]);
    expect(result.checked).toBe(1);
  });

  it('does not report a missing path deleted before the plan was created (restore case)', () => {
    const created = '2026-09-20T00:00:00Z';
    const deletedBefore = Math.floor(Date.parse(created) / 1000) - 1000;
    const doc = makeDoc([{ id: 'a', files_scope: ['src/restored.ts'] }], created);
    const result = checkPlanFreshness(doc, '/ws', () => false, () => deletedBefore);
    expect(result.missing).toEqual([]);
  });

  it('reports a missing path deleted after the plan was created', () => {
    const created = '2026-09-20T00:00:00Z';
    const deletedAfter = Math.floor(Date.parse(created) / 1000) + 1000;
    const doc = makeDoc([{ id: 'a', files_scope: ['src/drifted.ts'] }], created);
    const result = checkPlanFreshness(doc, '/ws', () => false, () => deletedAfter);
    expect(result.missing).toEqual(['src/drifted.ts']);
  });

  it('with no plan baseline, reports a missing path the probe reports as deleted', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/drifted.ts'] }]);
    const result = checkPlanFreshness(doc, '/ws', () => false, () => 12345);
    expect(result.missing).toEqual(['src/drifted.ts']);
  });

  it('calls the probe only for missing paths', () => {
    const doc = makeDoc([{ id: 'a', files_scope: ['src/exists.ts', 'src/gone.ts'] }]);
    const probed: string[] = [];
    checkPlanFreshness(
      doc,
      '/ws',
      (path) => path.endsWith('exists.ts'),
      (scope) => { probed.push(scope); return null; },
    );
    expect(probed).toEqual(['src/gone.ts']);
  });
});

describe('isDriftedPath', () => {
  it('is false when the path was never deleted', () => {
    expect(isDriftedPath(null, 100)).toBe(false);
  });

  it('is false when the deletion is before or at the baseline', () => {
    expect(isDriftedPath(50, 100)).toBe(false);
    expect(isDriftedPath(100, 100)).toBe(false);
  });

  it('is true when the deletion is after the baseline, or there is no baseline', () => {
    expect(isDriftedPath(150, 100)).toBe(true);
    expect(isDriftedPath(150, null)).toBe(true);
  });
});

describe('planCreatedEpoch', () => {
  it('parses an ISO 8601 created timestamp to epoch seconds', () => {
    expect(planCreatedEpoch(makeDoc([], '2026-09-20T00:00:00Z'))).toBe(1789862400);
  });

  it('returns null when created is missing or unparseable', () => {
    expect(planCreatedEpoch(makeDoc([]))).toBeNull();
    expect(planCreatedEpoch(makeDoc([], 'not-a-date'))).toBeNull();
  });
});

describe('formatPlanFreshnessRefusal', () => {
  it('lists every missing path and points at pan plan <id>', () => {
    const message = formatPlanFreshnessRefusal(['src/foo.ts', 'src/bar.ts'], 'PAN-42');
    expect(message).toContain('This plan was written against files that no longer exist.');
    expect(message).toContain('pan plan PAN-42');
    expect(message).toContain('src/foo.ts');
    expect(message).toContain('src/bar.ts');
  });

  it('caps the listed paths at 20 and summarizes the rest', () => {
    const missing = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
    const message = formatPlanFreshnessRefusal(missing, 'PAN-42');
    for (const path of missing.slice(0, 20)) {
      expect(message).toContain(path);
    }
    for (const path of missing.slice(20)) {
      expect(message).not.toContain(path);
    }
    expect(message).toContain('and 5 more');
  });
});
