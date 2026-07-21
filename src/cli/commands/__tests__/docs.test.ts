import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../../lib/config-yaml.js';
import { deterministicDocsTestEmbedding } from '../../../lib/docs/index-builder.js';
import { queryDocsIndex } from '../../../lib/docs/query.js';
import { createDocsCommand, runDocsReindex } from '../docs.js';

let rootDir: string;
let docsDir: string;
let syncSourcesRoot: string;

async function writeFixture(path: string, content: string): Promise<void> {
  const absolutePath = join(rootDir, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function docsConfig(overrides: {
  corpus?: Partial<NormalizedDocsConfig['corpus']>;
  embedding?: Partial<NormalizedDocsConfig['embedding']>;
} = {}): Pick<NormalizedDocsConfig, 'corpus' | 'embedding'> {
  const defaults = getDefaultDocsConfig();
  return {
    corpus: {
      ...defaults.corpus,
      skills: false,
      rules: false,
      claudeMd: false,
      prds: false,
      ...overrides.corpus,
    },
    embedding: {
      ...defaults.embedding,
      dimensions: 4,
      model: 'test-docs-embedding',
      ...overrides.embedding,
    },
  };
}

async function parseDocsCommand(args: string[], reindexOptions = {}): Promise<void> {
  const program = new Command();
  program.exitOverride();
  program.addCommand(createDocsCommand({ reindex: reindexOptions }));
  await program.parseAsync(['node', 'test', ...args]);
}

describe('docs command', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-command-'));
    docsDir = join(rootDir, 'overdeck-home', 'docs');
    syncSourcesRoot = join(rootDir, 'sync-sources');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('reindexes to the live docs index path and leaves the dist artifact untouched', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nHarness setup uses live docs.\n');

    const indexPath = join(docsDir, 'index.sqlite');
    const result = await runDocsReindex({
      docsDir,
      rootDir,
      syncSourcesRoot,
      config: docsConfig(),
      embeddingFn: deterministicDocsTestEmbedding,
    });

    expect(result.outputPath).toBe(indexPath);
    await expect(stat(indexPath)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(rootDir, 'dist', 'docs-index.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('builds an index that queryDocsIndex can read from the same live path', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nHarness setup uses live docs.\n');

    const indexPath = join(docsDir, 'index.sqlite');
    await runDocsReindex({
      indexPath,
      rootDir,
      syncSourcesRoot,
      config: docsConfig(),
      embeddingFn: deterministicDocsTestEmbedding,
    });

    const result = queryDocsIndex({ indexPath, query: 'harness' });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].docPath).toBe('docs/guide.md');
  });

  it('runs the reindex command without spawning the build script', async () => {
    await writeFixture('docs/guide.md', '# Guide\n\nHarness setup uses live docs.\n');
    const indexPath = join(docsDir, 'index.sqlite');
    const spawn = vi.fn(() => {
      throw new Error('spawn should not be called');
    });
    vi.doMock('child_process', () => ({ spawn }));

    await parseDocsCommand(['docs', 'reindex'], {
      docsDir,
      rootDir,
      syncSourcesRoot,
      config: docsConfig(),
      embeddingFn: deterministicDocsTestEmbedding,
    });

    await expect(stat(indexPath)).resolves.toMatchObject({
      size: expect.any(Number),
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prints a stderr hint when query uses a missing index path', async () => {
    const indexPath = join(docsDir, 'missing.sqlite');

    await parseDocsCommand(['docs', 'query', 'harness', '--index-path', indexPath]);

    expect(console.error).toHaveBeenCalledWith(`No docs index found at ${indexPath}. Run 'pan docs reindex' to build it.`);
    expect(console.log).toHaveBeenCalledWith('');
  });
});
