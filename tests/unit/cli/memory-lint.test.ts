import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPathRef } = vi.hoisted(() => ({ projectPathRef: { current: '' } }));
vi.mock('../../../src/lib/projects.js', () => ({
  findProjectByPath: (cwd: string) =>
    cwd === projectPathRef.current || cwd.startsWith(`${projectPathRef.current}/`)
      ? { name: 'P', path: projectPathRef.current }
      : null,
  getProjectSync: (key: string) => (key === 'overdeck' ? { name: 'P', path: projectPathRef.current } : null),
  resolveInfraRepo: (_project: unknown, root: string) => ({ repoPath: root, recordsPath: '.pan' }),
  resolveProjectKeyForCwdAsync: async () => 'overdeck',
}));

import type { ContradictionJudge } from '../../../src/lib/memory/facts/lint-contradictions.js';
import type { Embedder } from '../../../src/lib/memory/facts/lint-similarity.js';
import { memoryLintCommand } from '../../../src/cli/commands/memory-lint.js';

const VECTORS: Record<string, number[]> = {
  'dup-a': [1, 0, 0],
  'dup-b': [0.99, 0.14, 0],
  'enable-x': [0, 1, 0],
  'disable-x': [0, 0.8, 0.6],
};
const embedder: Embedder = async (texts) => ({
  model: 'fake-embed',
  embeddings: texts.map((text) => new Float32Array(VECTORS[text.split('\n')[0]])),
});

function promptPair(prompt: string): string {
  return [...prompt.matchAll(/\(id ([a-z0-9-]+),/g)].map((match) => match[1]).join('/');
}

const judge: ContradictionJudge = async (prompt) => ({
  status: 'extracted',
  provider: 'fake-provider',
  result: {
    data: promptPair(prompt) === 'disable-x/enable-x'
      ? { contradicts: true, reason: 'Enable versus disable.' }
      : { contradicts: false, reason: 'Agree.' },
    model: 'fake-model',
  } as never,
});

describe('pan memory lint (PAN-5360)', () => {
  let tmpRoot: string;
  let previousCwd: string;
  let previousHome: string | undefined;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'overdeck-memory-lint-cli-'));
    previousHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(tmpRoot, 'overdeck-home');
    projectRoot = join(tmpRoot, 'project');
    projectPathRef.current = projectRoot;
    const dir = join(projectRoot, '.overdeck', 'memory');
    mkdirSync(dir, { recursive: true });
    for (const id of Object.keys(VECTORS)) {
      writeFileSync(join(dir, `${id}.md`), `---\ntitle: ${id}\ntype: project\ndescription: ${id} rule.\n---\n\nBody.\n`, 'utf8');
    }
    previousCwd = process.cwd();
    process.chdir(projectRoot);

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

  it('prints a seeded duplicate and contradiction and exits 0', async () => {
    await memoryLintCommand({ embedder, judge });

    expect(exitCodes).toEqual([]);
    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toBe(`Memory lint: ${join(projectRoot, '.overdeck', 'memory')} (4 active of 4 facts; similarity: embedding)`);
    expect(lines).toContain('Links:');
    expect(lines).toContain('Duplicates (similarity >= 0.90):');
    expect(lines.some((line) => /^ {2}dup-a <-> dup-b {2}0\.99$/.test(line))).toBe(true);
    expect(lines).toContain('Contradictions (fake-provider/fake-model, 2 pairs checked):');
    expect(lines).toContain('  disable-x <-> enable-x: Enable versus disable.');
    const linksAt = lines.indexOf('Links:');
    expect(lines[linksAt + 1]).toBe('  none');
  });

  it('--json emits the report shape', async () => {
    await memoryLintCommand({ embedder, judge, json: true });
    const report = JSON.parse(logSpy.mock.calls.map((call) => String(call[0])).join(''));
    expect(Object.keys(report)).toEqual(expect.arrayContaining(['links', 'duplicates', 'similarity', 'contradictions']));
    expect(report.duplicates).toEqual([{ a: 'dup-a', b: 'dup-b', score: expect.any(Number) }]);
    expect(report.contradictions.findings).toEqual([{ a: 'disable-x', b: 'enable-x', reason: 'Enable versus disable.' }]);
  });

  it('--threshold 2 exits 1', async () => {
    await expect(memoryLintCommand({ threshold: '2', embedder, judge })).rejects.toThrow();
    expect(exitCodes).toEqual([1]);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--threshold must be a number greater than 0 and at most 1');
  });

  it('--no-llm reports contradictions skipped and never calls the judge', async () => {
    const spyJudge = vi.fn<ContradictionJudge>();
    await memoryLintCommand({ llm: false, embedder, judge: spyJudge });
    expect(spyJudge).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain('Contradictions: skipped (llm disabled (--no-llm))');
    expect(exitCodes).toEqual([]);
  });

  it('prints the lexical fallback reason when the embedder fails', async () => {
    const failing: Embedder = async () => {
      throw new Error('quota exhausted');
    };
    await memoryLintCommand({ llm: false, embedder: failing });
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toContain('Similarity fell back to lexical: quota exhausted');
  });

  it('exits 1 outside a registered project', async () => {
    process.chdir(tmpRoot);
    await expect(memoryLintCommand({ llm: false, embedder: null })).rejects.toThrow();
    expect(exitCodes).toEqual([1]);
  });
});
