import { describe, expect, it } from 'vitest';

import { compareBeadsSources, reportMarkdown } from '../../../../src/lib/beads/reconcile.js';

describe('beads reconciliation inventory', () => {
  it('accounts for identical, one-sided, conflicting, and scope-excluded records', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'local-only', title: 'Local' },
        { id: 'conflict', title: 'Local title' },
        { id: 'config', type: 'config', value: true },
      ],
      'remote-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'remote-only', title: 'Remote' },
        { id: 'conflict', title: 'Remote title' },
        { id: 'config', type: 'config', value: true },
      ],
      'state-jsonl': [
        { id: 'same', title: 'Same' },
        { id: 'conflict', title: 'Older title' },
      ],
    });
    expect(Object.fromEntries(inventory.differences.map((row) => [row.id, row.classification]))).toEqual({
      config: 'outside-export-scope',
      conflict: 'conflicting',
      'local-only': 'one-sided',
      'remote-only': 'one-sided',
      same: 'identical',
    });
    expect(inventory.differences).toHaveLength(5);
  });

  it('classifies updated_at-only differences as metadata-drift', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [{ id: 'drift', title: 'Same', updated_at: '2026-07-12T10:00:00Z' }],
      'remote-dolt': [{ id: 'drift', title: 'Same', updated_at: '2026-07-12T11:00:00Z' }],
      'state-jsonl': [{ id: 'drift', title: 'Same', updated_at: '2026-07-12T09:00:00Z' }],
    });
    expect(inventory.differences[0].classification).toBe('metadata-drift');
  });

  it('does not let metadata-drift mask real conflicts', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [{ id: 'conflict', title: 'Local', updated_at: '2026-07-12T10:00:00Z' }],
      'remote-dolt': [{ id: 'conflict', title: 'Remote', updated_at: '2026-07-12T11:00:00Z' }],
      'state-jsonl': [{ id: 'conflict', title: 'Older', updated_at: '2026-07-12T09:00:00Z' }],
    });
    expect(inventory.differences[0].classification).toBe('conflicting');
  });

  it('includes summary counts and preserves the full inventory table', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'drift', title: 'Same', updated_at: '2026-07-12T10:00:00Z' },
      ],
      'remote-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'drift', title: 'Same', updated_at: '2026-07-12T11:00:00Z' },
      ],
      'state-jsonl': [
        { id: 'same', title: 'Same' },
        { id: 'drift', title: 'Same', updated_at: '2026-07-12T09:00:00Z' },
      ],
    });
    const report = reportMarkdown(
      { projectKey: 'test', projectPath: '/tmp', stateRoot: '/tmp', remoteUrl: 'https://example.com/repo.git' },
      inventory,
      { local: 'abc1234', remote: 'def5678' },
    );
    expect(report).toContain('## Summary by classification');
    expect(report).toContain('- identical: 1');
    expect(report).toContain('- metadata-drift: 1');
    expect(report).toContain('## Full inventory');
    expect(report).toContain('| same | identical |');
    expect(report).toContain('| drift | metadata-drift |');
    expect(report).toContain('*metadata-drift* means the only differing field is `updated_at`');
  });
});
