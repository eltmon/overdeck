import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../config-yaml.js';
import type { DocsPathOverrides } from '../../paths.js';
import {
  buildDocsIndex,
  deterministicDocsTestEmbedding,
} from '../index-builder.js';
import { buildDocsInjectionContext } from '../injection.js';
import { readDocsBudgetState, recordDocsInjection } from '../state.js';

let rootDir: string;
let paths: DocsPathOverrides;
let syncSourcesRoot: string;

async function writeFixture(path: string, content: string): Promise<void> {
  const absolutePath = join(rootDir, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function docsConfig(overrides: {
  enabled?: boolean;
  promptInjectionEnabled?: boolean;
  trigger?: Partial<NormalizedDocsConfig['trigger']>;
  budget?: Partial<NormalizedDocsConfig['budget']>;
  corpus?: Partial<NormalizedDocsConfig['corpus']>;
  embedding?: Partial<NormalizedDocsConfig['embedding']>;
} = {}): Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget' | 'corpus' | 'embedding'> {
  const defaults = getDefaultDocsConfig();
  return {
    enabled: overrides.enabled ?? defaults.enabled,
    promptInjectionEnabled: overrides.promptInjectionEnabled ?? defaults.promptInjectionEnabled,
    trigger: { ...defaults.trigger, ...overrides.trigger },
    budget: { ...defaults.budget, ...overrides.budget },
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

async function buildFixtureIndex(content = '# Guide\n\nPan harness docs explain workspace setup.\n'): Promise<void> {
  await writeFixture('docs/guide.md', content);
  const config = docsConfig();
  await buildDocsIndex({
    outputPath: paths.indexPath,
    rootDir,
    syncSourcesRoot,
    config,
    embeddingFn: deterministicDocsTestEmbedding,
  });
}

describe('docs injection service', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-docs-injection-'));
    syncSourcesRoot = join(rootDir, 'sync-sources');
    paths = {
      indexPath: join(rootDir, 'docs-state', 'index.sqlite'),
      budgetStatePath: join(rootDir, 'docs-state', 'budget-state.json'),
      disableStatePath: join(rootDir, 'docs-state', 'disable-state.json'),
      telemetryPath: join(rootDir, 'docs-state', 'telemetry.jsonl'),
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('returns no context when docs injection is disabled', async () => {
    await buildFixtureIndex();

    const result = await buildDocsInjectionContext({
      prompt: 'pan harness docs',
      sessionId: 'disabled',
      config: docsConfig({ enabled: false }),
      paths,
    });

    expect(result).toEqual({ injected: false, context: null, reason: 'docs_disabled' });
    await expect(readFile(paths.telemetryPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns no context when the prompt does not match docs triggers', async () => {
    await buildFixtureIndex();

    const result = await buildDocsInjectionContext({
      prompt: 'ordinary prompt',
      sessionId: 'plain',
      config: docsConfig({ trigger: { regexes: ['pan'] } }),
      paths,
    });

    expect(result).toEqual({ injected: false, context: null, reason: 'no_trigger' });
    await expect(readFile(paths.telemetryPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns no context when the budget is exhausted', async () => {
    await buildFixtureIndex();
    const config = docsConfig({ budget: { injectionRate: 1, turnWindow: 10 } });
    await recordDocsInjection({ budgetKey: 'session:budgeted', tokens: 100, paths });

    const result = await buildDocsInjectionContext({
      prompt: 'pan harness docs',
      sessionId: 'budgeted',
      config,
      paths,
    });

    expect(result).toEqual({ injected: false, context: null, reason: 'budget_exhausted' });
    await expect(readFile(paths.telemetryPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns no context when the index is missing', async () => {
    const result = await buildDocsInjectionContext({
      prompt: 'pan harness docs',
      sessionId: 'missing-index',
      config: docsConfig(),
      paths,
    });

    expect(result).toEqual({ injected: false, context: null });
    const state = await readDocsBudgetState(paths);
    expect(state.records['session:missing-index'].injections).toEqual([]);
  });

  it('returns docs context and advances budget exactly once for a matching prompt', async () => {
    await buildFixtureIndex();

    const result = await buildDocsInjectionContext({
      prompt: 'pan harness docs',
      sessionId: 'happy',
      projectPath: rootDir,
      config: docsConfig(),
      paths,
      now: new Date('2026-07-12T17:00:00.000Z'),
    });

    expect(result.injected).toBe(true);
    expect(result.context).toContain('<overdeck-docs>');
    expect(result.context).toContain('docs/guide.md');

    const state = await readDocsBudgetState(paths);
    expect(state.records['session:happy'].injections).toHaveLength(1);
    expect(state.records['session:happy'].injections[0]).toMatchObject({ turn: 1, tokens: expect.any(Number) });

    const telemetry = JSON.parse((await readFile(paths.telemetryPath!, 'utf8')).trim()) as Record<string, unknown>;
    expect(telemetry).toMatchObject({
      event: 'injection',
      queryCount: 1,
      injectedTokens: expect.any(Number),
      hit: true,
      matched: expect.arrayContaining(['pan']),
      budgetKey: 'session:happy',
      chunkCount: 1,
    });
  });

  it('does not advance the injection budget when a triggered query has no results', async () => {
    await buildFixtureIndex('# Guide\n\nUnrelated workspace setup.\n');

    const result = await buildDocsInjectionContext({
      prompt: 'needle',
      sessionId: 'empty',
      config: docsConfig({ trigger: { regexes: ['needle'] } }),
      paths,
    });

    expect(result).toEqual({ injected: false, context: null });
    const state = await readDocsBudgetState(paths);
    expect(state.records['session:empty'].injections).toEqual([]);
    await expect(readFile(paths.telemetryPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
