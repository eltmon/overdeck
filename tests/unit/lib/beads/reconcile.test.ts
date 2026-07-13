import { describe, expect, it } from 'vitest';

import { compareBeadsSources, reconcileBeads, reportMarkdown } from '../../../../src/lib/beads/reconcile.js';

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
    expect(report).toContain('## Source record counts');
    expect(report).toContain('- local-dolt:');
    expect(report).toContain('- remote-dolt:');
    expect(report).toContain('- state-jsonl:');
    expect(report).toContain('## Full inventory');
    expect(report).toContain('| same | identical |');
    expect(report).toContain('| drift | metadata-drift |');
    expect(report).toContain('*metadata-drift* means the only differing field is `updated_at`');
  });

  it('includes extra stores in comparison and source counts', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [{ id: 'shared', title: 'Shared' }],
      'remote-dolt': [{ id: 'shared', title: 'Shared' }],
      'state-jsonl': [{ id: 'shared', title: 'Shared' }],
      'extra': [{ id: 'shared', title: 'Shared' }],
    });
    expect(inventory.counts).toHaveProperty('extra', 1);
    expect(inventory.differences[0].classification).toBe('identical');
    expect(inventory.differences[0].presentIn).toContain('extra');
  });

  it('classifies records missing from any compared source as one-sided regardless of source count', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [{ id: 'partial', title: 'Partial' }],
      'remote-dolt': [{ id: 'partial', title: 'Partial' }],
      'state-jsonl': [{ id: 'partial', title: 'Partial' }],
      'extra': [],
    });
    expect(inventory.differences[0].classification).toBe('one-sided');
  });

  it('rejects reserved extra store names during reconcile', async () => {
    await expect(
      reconcileBeads({
        projectKey: 'test',
        projectPath: '/tmp',
        stateRoot: '/tmp',
        remoteUrl: 'https://example.com/repo.git',
        extraStores: [{ name: 'local-dolt', path: '/tmp' }],
        execute: async () => '',
      }),
    ).rejects.toThrow('Reserved extra store name: local-dolt');
  });

  it('degrades to a zero-record remote when refs/dolt/data is not published', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const calls: { file: string; args: readonly string[]; cwd: string }[] = [];
    const execute = async (file: string, args: readonly string[], cwd: string) => {
      calls.push({ file, args, cwd });
      if (file === 'git' && args[0] === 'fetch') {
        const error = new Error("fatal: couldn't find remote ref refs/dolt/data") as Error & { stderr?: string };
        error.stderr = "fatal: couldn't find remote ref refs/dolt/data";
        throw error;
      }
      if (file === 'bd' && args[0] === 'export') {
        const outPath = args[3];
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, '');
        return '';
      }
      if (file === 'bd' && args[0] === 'vc') return 'Commit: abc1234';
      if (file === 'bd' && args[0] === 'list') return '[]';
      return '';
    };
    const result = await reconcileBeads({
      projectKey: 'test',
      projectPath: '/tmp',
      stateRoot: '/tmp',
      remoteUrl: 'https://example.com/repo.git',
      execute,
    });
    expect(result.inventory.counts['remote-dolt']).toBe(0);
    const report = await import('node:fs/promises').then(({ readFile }) => readFile(result.reportPath, 'utf8'));
    expect(report).toContain('remote-dolt: 0 (refs/dolt/data not published)');
    expect(report).toContain('not published');
  });
});
