import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity } from '@overdeck/contracts';
import type { ContradictionJudge } from '../../../../../src/lib/memory/facts/lint-contradictions.js';
import type { Embedder } from '../../../../../src/lib/memory/facts/lint-similarity.js';
import { lintMemoryFacts } from '../../../../../src/lib/memory/facts/lint.js';

const IDENTITY: MemoryIdentity = {
  projectId: 'test',
  workspaceId: 'memory-lint',
  issueId: null,
  runId: 'memory-lint',
  sessionId: 'memory-lint-test',
  agentRole: 'conversation',
  agentHarness: 'overdeck',
};

/** Vector per fact id; the embedder reads the id from the first line (the title). */
const VECTORS: Record<string, number[]> = {
  'dup-a': [1, 0, 0, 0],
  'dup-b': [0.99, 0.14, 0, 0],
  'enable-x': [0, 0, 1, 0],
  'disable-x': [0, 0, 0.8, 0.6],
  'new-rule': [0, 1, 0, 0],
  'old-rule': [0, 1, 0, 0],
};

const embedder: Embedder = async (texts) => ({
  model: 'fake-embed',
  embeddings: texts.map((text) => new Float32Array(VECTORS[text.split('\n')[0]])),
});

function promptPair(prompt: string): string {
  return [...prompt.matchAll(/\(id ([a-z0-9-]+),/g)].map((match) => match[1]).join('/');
}

describe('lintMemoryFacts', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'overdeck-memory-lint-')), 'memory');
    mkdirSync(dir, { recursive: true });
    const write = (id: string, frontmatter: string) => writeFileSync(
      join(dir, `${id}.md`),
      `---\ntitle: ${id}\ntype: project\ndescription: ${id} rule.\n${frontmatter}---\n\nBody of ${id}.\n`,
      'utf8',
    );
    write('dup-a', '');
    write('dup-b', '');
    write('enable-x', '');
    write('disable-x', '');
    write('new-rule', 'supersedes:\n  - old-rule\n');
    write('old-rule', 'status: superseded\nsuperseded_by: new-rule\n');
  });

  afterEach(() => {
    rmSync(join(dir, '..'), { recursive: true, force: true });
  });

  it('seeded duplicate pair and seeded contradiction both appear in one report', async () => {
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

    const report = await lintMemoryFacts({ dir, scope: 'project', llm: true, embedder, judge, identity: IDENTITY });

    expect(report.factCount).toBe(6);
    expect(report.activeCount).toBe(5);
    expect(report.problems).toEqual([]);
    expect(report.links).toEqual([]);
    expect(report.similarity).toEqual({ method: 'embedding', model: 'fake-embed', duplicateThreshold: 0.9 });
    expect(report.duplicates).toEqual([{ a: 'dup-a', b: 'dup-b', score: expect.any(Number) }]);
    expect(report.contradictions.status).toBe('checked');
    expect(report.contradictions.findings).toEqual([{ a: 'disable-x', b: 'enable-x', reason: 'Enable versus disable.' }]);
  });

  it('a superseded fact and its successor are not compared', async () => {
    const seen: string[] = [];
    const judge: ContradictionJudge = async (prompt) => {
      seen.push(promptPair(prompt));
      return { status: 'extracted', provider: 'p', result: { data: { contradicts: false, reason: 'ok' }, model: 'm' } as never };
    };

    const report = await lintMemoryFacts({ dir, scope: 'project', llm: true, embedder, judge, identity: IDENTITY });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((pair) => pair.includes('old-rule'))).toBe(false);
    expect(report.duplicates.some((pair) => pair.a === 'old-rule' || pair.b === 'old-rule')).toBe(false);
  });

  it('writes no file', async () => {
    const snapshot = () => readdirSync(dir).sort().map((name) => [name, statSync(join(dir, name)).mtimeMs]);
    const before = snapshot();
    await lintMemoryFacts({ dir, scope: 'project', llm: false, embedder: null, identity: IDENTITY });
    expect(snapshot()).toEqual(before);
  });

  it('--no-llm skips the judge and a threshold override applies to duplicates', async () => {
    const judge = vi.fn<ContradictionJudge>();
    const report = await lintMemoryFacts({ dir, scope: 'project', llm: false, threshold: 0.75, embedder, judge, identity: IDENTITY });
    expect(judge).not.toHaveBeenCalled();
    expect(report.contradictions).toEqual({
      status: 'skipped', reason: 'llm disabled (--no-llm)', pairsChecked: 0, pairsFailed: 0, findings: [],
    });
    expect(report.similarity.duplicateThreshold).toBe(0.75);
    expect(report.duplicates.map((pair) => `${pair.a}/${pair.b}`)).toEqual(['dup-a/dup-b', 'disable-x/enable-x']);
  });

  it('reports the embedder error as the fallback reason and uses the lexical threshold', async () => {
    const failing: Embedder = async () => {
      throw new Error('embedding quota exhausted');
    };
    const report = await lintMemoryFacts({ dir, scope: 'project', llm: false, embedder: failing, identity: IDENTITY });
    expect(report.similarity).toEqual({ method: 'lexical', fallbackReason: 'embedding quota exhausted', duplicateThreshold: 0.6 });
  });
});
