import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BeadsResolver } from '../../../../src/lib/beads/resolver.js';

describe('BeadsResolver', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
  it('returns typed Dolt-backed reads for a redirect-only workspace', async () => {
    const execute = vi.fn(async () => JSON.stringify([{ id: 'pan-1-a', title: 'A', status: 'open', labels: ['pan-1'] }]));
    const resolver = new BeadsResolver('/tmp/feature-pan-1', { execute });
    await expect(resolver.issueHasBeads('PAN-1')).resolves.toEqual({ ok: true, value: true });
    expect(execute).toHaveBeenCalledWith(
      ['list', '--json', '-l', 'pan-1', '--status', 'all', '--limit', '0'],
      '/tmp/feature-pan-1',
    );
  });

  it('marks a failed canonical read stale instead of fabricating an empty result', async () => {
    const resolver = new BeadsResolver('/tmp/project', {
      execute: async () => { throw new Error('Dolt unavailable'); },
      retry: { maxAttempts: 1 },
    });
    const result = await resolver.getBeadsForIssue('PAN-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale, not empty/);
  });

  it('serializes simultaneous reads instead of treating concurrent work as reentrant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'resolver-serialize-'));
    roots.push(root);
    const priorHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, 'home');
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    let executions = 0;
    const execute = vi.fn(async () => {
      executions += 1;
      if (executions === 1) { markFirstEntered(); await firstBlocked; }
      return '[]';
    });
    try {
      const resolver = new BeadsResolver(root, { execute });
      const first = resolver.getBeadsForIssue('PAN-1');
      await firstEntered;
      const second = resolver.getBeadsForIssue('PAN-2');
      await Promise.resolve();
      expect(executions).toBe(1);
      releaseFirst();
      await Promise.all([first, second]);
      expect(executions).toBe(2);
    } finally {
      if (priorHome === undefined) delete process.env.OVERDECK_HOME;
      else process.env.OVERDECK_HOME = priorHome;
    }
  });
});
