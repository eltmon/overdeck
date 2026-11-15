import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryReindexCommand } from '../../../src/cli/commands/memory-reindex.js';
import { machineMemoryDir, userMemoryDir, writeMemoryFact } from '../../../src/lib/memory/facts/store.js';
import type { DocsEmbeddingConfig } from '../../../src/lib/memory/facts/vectors.js';

describe('pan memory reindex (PAN-5358 WI-10)', () => {
  let tmpRoot: string;
  let previousHome: string | undefined;
  let previousCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-reindex-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    previousCwd = process.cwd();
    process.chdir(tmpRoot);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitCodes = [];
    vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      exitCodes.push(code ?? 0);
      throw new Error(`exit(${code ?? 0})`);
    });
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const output = () => logSpy.mock.calls.flat().join('\n');

  it('reports embedded and reused counts per store, and skips the project store outside a registered project', async () => {
    await writeMemoryFact(userMemoryDir(), 'user', {
      id: 'operator-fact', type: 'feedback', title: 'Operator fact', description: 'Describes an operator topic.',
      tags: [], updated: null, source: null, review: [], body: '',
    });
    await writeMemoryFact(machineMemoryDir(), 'machine', {
      id: 'machine-fact', type: 'feedback', title: 'Machine fact', description: 'Describes a machine topic.',
      tags: [], updated: null, source: null, review: [], body: '',
    });

    const refresh = vi.fn(async ({ facts }: { facts: readonly unknown[] }) => ({ embedded: facts.length, reused: 0 }));
    await memoryReindexCommand({ refresh });

    expect(exitCodes).toEqual([]);
    expect(output()).toContain('project: skipped (cwd owns no project; pass --project <key> to include one)');
    expect(output()).toContain('user: 1 embedded, 0 reused');
    expect(output()).toContain('machine: 1 embedded, 0 reused');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('exits 1 when embedding fails', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('embedding provider unreachable');
    });
    await expect(memoryReindexCommand({ refresh })).rejects.toThrow('exit(1)');
    expect(exitCodes).toEqual([1]);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('embedding provider unreachable');
  });

  it('--json prints the stores array', async () => {
    const refresh = vi.fn(async () => ({ embedded: 0, reused: 0 }));
    await memoryReindexCommand({ json: true, refresh });

    const parsed = JSON.parse(output()) as { stores: Array<{ scope: string; dir: string; embedded: number; reused: number }> };
    expect(parsed.stores).toHaveLength(2);
    expect(parsed.stores.map((store) => store.scope).sort()).toEqual(['machine', 'user']);
    expect(parsed.stores.every((store) => store.embedded === 0 && store.reused === 0)).toBe(true);
  });

  it('reads the embedding config via refresh for every store', async () => {
    const refresh = vi.fn(async (input: { config: DocsEmbeddingConfig }) => {
      expect(input.config).toBeDefined();
      return { embedded: 0, reused: 0 };
    });
    await memoryReindexCommand({ refresh });
    expect(refresh).toHaveBeenCalled();
  });
});
