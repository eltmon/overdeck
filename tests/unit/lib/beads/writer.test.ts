import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatMutationBatchFailure, runMutationBatch } from '../../../../src/lib/beads/writer.js';

function harness(failOn?: string) {
  const calls: string[] = [];
  const status = '\n📊 Version Control Status\n\n  Branch: main\n  Commit: dmqijeb6\n\n';
  const execute = vi.fn(async (args: readonly string[]) => {
    const command = args.join(' ');
    calls.push(command);
    if (command === failOn) throw new Error(command.includes('push') ? 'non-fast-forward rejected' : 'operation failed');
    if (command === 'vc status') return status;
    if (command.includes('remote show')) return JSON.stringify({ head: '1234567890123456789012345678901234567890' });
    return '';
  });
  const exportSnapshot = vi.fn(async () => { calls.push('export-snapshot'); });
  const withLock = vi.fn(async (_caller, fn) => { calls.push('lock'); return fn(); });
  return { calls, execute, exportSnapshot, withLock };
}

async function withProjectDir<T>(hasEmbeddedStore: boolean, fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'beads-writer-'));
  try {
    if (hasEmbeddedStore) {
      const storePath = join(cwd, '.beads', 'embeddeddolt', 'overdeck');
      await mkdir(storePath, { recursive: true });
      await writeFile(join(storePath, 'store'), 'present');
    }
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function withRedirectedProjectDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'beads-writer-project-'));
  const redirectedBeadsDir = await mkdtemp(join(tmpdir(), 'beads-writer-state-'));
  try {
    await mkdir(join(cwd, '.beads'), { recursive: true });
    await writeFile(join(cwd, '.beads', 'redirect'), `${redirectedBeadsDir}\n`);
    const storePath = join(redirectedBeadsDir, 'embeddeddolt', 'overdeck');
    await mkdir(storePath, { recursive: true });
    await writeFile(join(storePath, 'store'), 'present');
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(redirectedBeadsDir, { recursive: true, force: true });
  }
}

describe('runMutationBatch', () => {
  it('uses an existing embedded Dolt store without bootstrapping, then pulls, commits, exports, and pushes once', async () => {
    const h = harness();
    const result = await withProjectDir(true, (workspacePath) =>
      runMutationBatch(
        { project: { workspacePath }, reason: 'close planned beads' },
        async (bd) => {
          await bd.mutate(['close', 'one']);
          await bd.mutate(['close', 'two']);
          return 2;
        },
        h,
      ),
    );
    expect(result).toMatchObject({ ok: true, value: 2 });
    expect(h.withLock).toHaveBeenCalledOnce();
    expect(h.calls).toEqual([
      'lock',
      'dolt pull',
      'vc status',
      'dolt remote show origin --json',
      'close one --dolt-auto-commit batch',
      'close two --dolt-auto-commit batch',
      'dolt commit -m close planned beads',
      'export-snapshot',
      'dolt push',
      'vc status',
    ]);
  });

  it('uses a redirected existing embedded Dolt store without bootstrapping', async () => {
    const h = harness();
    const result = await withRedirectedProjectDir((workspacePath) =>
      runMutationBatch(
        { project: { workspacePath }, reason: 'close redirected beads' },
        (bd) => bd.mutate(['close', 'one']),
        h,
      ),
    );
    expect(result).toMatchObject({ ok: true, value: '' });
    expect(h.calls).toEqual([
      'lock',
      'dolt pull',
      'vc status',
      'dolt remote show origin --json',
      'close one --dolt-auto-commit batch',
      'dolt commit -m close redirected beads',
      'export-snapshot',
      'dolt push',
      'vc status',
    ]);
  });

  it('bootstraps when the embedded Dolt store is absent or empty', async () => {
    const h = harness();
    const result = await withProjectDir(false, (workspacePath) =>
      runMutationBatch(
        { project: { workspacePath }, reason: 'close planned beads' },
        (bd) => bd.mutate(['close', 'one']),
        h,
      ),
    );
    expect(result).toMatchObject({ ok: true, value: '' });
    expect(h.calls).toEqual([
      'lock',
      'bootstrap --yes --json',
      'dolt pull',
      'vc status',
      'dolt remote show origin --json',
      'close one --dolt-auto-commit batch',
      'dolt commit -m close planned beads',
      'export-snapshot',
      'dolt push',
      'vc status',
    ]);
  });

  it('preserves a failed working set for recovery and never commits or pushes it', async () => {
    const h = harness('update two --dolt-auto-commit batch');
    const result = await runMutationBatch(
      { project: { workspacePath: '/tmp/project' }, reason: 'update planned beads' },
      async (bd) => {
        await bd.mutate(['update', 'one']);
        await bd.mutate(['update', 'two']);
      },
      h,
    );
    expect(result).toMatchObject({ ok: false, needsOperatorRecovery: true });
    expect(h.calls).not.toContain('dolt push');
    expect(h.calls.some((call) => call.startsWith('dolt commit'))).toBe(false);
  });

  it('does not classify maxBuffer failures as conflicts based on partial stdout content', async () => {
    const h = harness();
    const cause = Object.assign(new Error('stdout maxBuffer length exceeded'), {
      stdout: JSON.stringify([{ id: 'PAN-1', title: 'contains the word conflict in bead content' }]),
    });
    const result = await withProjectDir(true, (workspacePath) =>
      runMutationBatch(
        { project: { workspacePath }, reason: 'export large beads' },
        (bd) => bd.mutate(['create', 'one']),
        { ...h, exportSnapshot: vi.fn(async () => { h.calls.push('export-snapshot'); throw cause; }) },
      ),
    );

    expect(result).toMatchObject({ ok: false, needsOperatorRecovery: true });
    expect(result).toHaveProperty('cause', cause);
    expect(h.calls).not.toContain('dolt push');
    if (result.ok) throw new Error('expected mutation batch failure');
    expect(formatMutationBatchFailure(result)).toContain('stdout maxBuffer length exceeded');
  });

  it('formats operator recovery failures with the captured cause', async () => {
    const cause = Object.assign(new Error('operation failed'), {
      stderr: 'Bootstrap failed: clone from remote: database exists',
    });
    const formatted = formatMutationBatchFailure({
      ok: false,
      needsOperatorRecovery: true,
      localHead: null,
      message: 'The mutation batch failed before push.',
      cause,
    });

    expect(formatted).toContain('The mutation batch failed before push.');
    expect(formatted).toContain('Bootstrap failed: clone from remote: database exists');
  });

  it('returns a typed conflict when push is rejected and never force-pushes', async () => {
    const h = harness('dolt push');
    const result = await runMutationBatch(
      { project: { workspacePath: '/tmp/project' }, reason: 'close one' },
      (bd) => bd.mutate(['close', 'one']),
      h,
    );
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(h.calls.join('\n')).not.toContain('--force');
  });
});
