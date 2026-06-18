/**
 * PAN-1510 — bootstrap and getSnapshot must surface issues that exist in
 * IssueDataService but are missing from the projection cache.
 *
 * Mirrors the PAN-1506 pattern (`discoverNewAgentIds`). The bug: the
 * projection cache flush is debounced ~2s, so a fresh issueService
 * `cache.set('github', 'issues', ...)` can survive a dashboard restart while
 * the projection cache row stays at the previous snapshot. Without merging
 * the two views the read model's `issuesRaw` is stuck at the stale set even
 * after a hard browser reload — even though `/api/issues` (which reads
 * issueService directly) returns the fresh set.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverNewIssues,
  getIssueIdentifierKey,
  mergeIssuesByIdentifier,
} from '../../src/dashboard/server/read-model.js';

const issue = (identifier: string, extra: Record<string, unknown> = {}) => ({
  identifier,
  id: `github-eltmon-overdeck-${identifier.replace(/^PAN-/, '')}`,
  title: `${identifier} title`,
  ...extra,
});

describe('getIssueIdentifierKey()', () => {
  it('prefers identifier over id and lowercases', () => {
    expect(getIssueIdentifierKey({ identifier: 'PAN-1', id: 'github-x-y-1' })).toBe('pan-1');
  });

  it('falls back to id when identifier missing', () => {
    expect(getIssueIdentifierKey({ id: 'github-x-y-7' })).toBe('github-x-y-7');
  });

  it('returns null for unidentifiable shapes', () => {
    expect(getIssueIdentifierKey(null)).toBeNull();
    expect(getIssueIdentifierKey('PAN-1')).toBeNull();
    expect(getIssueIdentifierKey({})).toBeNull();
    expect(getIssueIdentifierKey({ identifier: '' })).toBeNull();
    expect(getIssueIdentifierKey({ identifier: 42 })).toBeNull();
  });
});

describe('discoverNewIssues()', () => {
  it('returns issues whose identifier is not in the cached set', () => {
    const cached = [issue('PAN-1'), issue('PAN-2')];
    const current = [issue('PAN-1'), issue('PAN-2'), issue('PAN-3'), issue('PAN-4')];
    const newOnes = discoverNewIssues(cached, current);
    expect(newOnes.map(getIssueIdentifierKey).sort()).toEqual(['pan-3', 'pan-4']);
  });

  it('compares case-insensitively', () => {
    const cached = [issue('pan-1')];
    const current = [issue('PAN-1'), issue('PAN-2')];
    expect(discoverNewIssues(cached, current).map(getIssueIdentifierKey)).toEqual(['pan-2']);
  });

  it('returns empty when current is a subset of cached', () => {
    const cached = [issue('PAN-1'), issue('PAN-2'), issue('PAN-3')];
    const current = [issue('PAN-1')];
    expect(discoverNewIssues(cached, current)).toEqual([]);
  });

  it('returns everything when cached is empty', () => {
    const current = [issue('PAN-1'), issue('PAN-2')];
    expect(discoverNewIssues([], current).map(getIssueIdentifierKey)).toEqual(['pan-1', 'pan-2']);
  });

  it('ignores unidentifiable issues in current', () => {
    const cached = [issue('PAN-1')];
    const current = [issue('PAN-2'), { junk: true }, null];
    expect(discoverNewIssues(cached, current).map(getIssueIdentifierKey)).toEqual(['pan-2']);
  });
});

describe('mergeIssuesByIdentifier()', () => {
  it('returns the union with current winning identifier ties', () => {
    const cached = [issue('PAN-1', { status: 'Todo' }), issue('PAN-2', { status: 'Todo' })];
    const current = [
      issue('PAN-1', { status: 'In Progress' }),
      issue('PAN-3', { status: 'Todo' }),
    ];

    const merged = mergeIssuesByIdentifier(cached, current);
    const byId = new Map(merged.map(i => [getIssueIdentifierKey(i)!, i as Record<string, unknown>]));

    expect(byId.size).toBe(3);
    expect(byId.get('pan-1')?.['status']).toBe('In Progress');
    expect(byId.get('pan-2')?.['status']).toBe('Todo');
    expect(byId.get('pan-3')?.['status']).toBe('Todo');
  });

  it('preserves cached issues that current is missing (defensive against partial fetches)', () => {
    const cached = [issue('PAN-1'), issue('PAN-2'), issue('PAN-3')];
    const current = [issue('PAN-1')];
    const merged = mergeIssuesByIdentifier(cached, current);
    expect(merged.map(getIssueIdentifierKey).sort()).toEqual(['pan-1', 'pan-2', 'pan-3']);
  });

  it('falls back to current when cached is empty', () => {
    const current = [issue('PAN-7')];
    expect(mergeIssuesByIdentifier([], current)).toEqual(current);
  });

  it('keeps unidentifiable cached entries instead of silently dropping them', () => {
    const junk = { kind: 'placeholder', identifier: '' };
    const cached: unknown[] = [issue('PAN-1'), junk];
    const current = [issue('PAN-2')];
    const merged = mergeIssuesByIdentifier(cached, current);
    expect(merged).toContain(junk);
    expect(merged.map(getIssueIdentifierKey).filter(Boolean).sort()).toEqual(['pan-1', 'pan-2']);
  });

  it('reproduces the PAN-1510 symptom and proves the fix', () => {
    // Mirrors the symptom: projection cache has the older session's snapshot
    // (max identifier PAN-1506), and IssueDataService already knows about
    // PAN-1507/1508/1509 that were filed during the previous run.
    const cached = [issue('PAN-1504'), issue('PAN-1505'), issue('PAN-1506')];
    const current = [
      issue('PAN-1504'),
      issue('PAN-1505'),
      issue('PAN-1506'),
      issue('PAN-1507'),
      issue('PAN-1508'),
      issue('PAN-1509'),
    ];

    const newIssues = discoverNewIssues(cached, current);
    expect(newIssues.map(getIssueIdentifierKey)).toEqual(['pan-1507', 'pan-1508', 'pan-1509']);

    const merged = mergeIssuesByIdentifier(cached, current);
    const ids = new Set(merged.map(getIssueIdentifierKey));
    expect(merged).toHaveLength(6);
    expect(ids.has('pan-1506')).toBe(true);
    expect(ids.has('pan-1507')).toBe(true);
    expect(ids.has('pan-1508')).toBe(true);
    expect(ids.has('pan-1509')).toBe(true);
  });
});
