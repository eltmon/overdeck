import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryIdentity } from '@overdeck/contracts';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../../../../lib/config-yaml.js';
import type { DocsPathOverrides } from '../../../../lib/paths.js';
import {
  buildDocsIndex,
  deterministicDocsTestEmbedding,
} from '../../../../lib/docs/index-builder.js';
import { queryDocsIndex } from '../../../../lib/docs/query.js';
import { readDocsBudgetState } from '../../../../lib/docs/state.js';
import {
  handleMemoryInjectBody,
  handleMemoryInjectFastPathBody,
} from '../hooks.js';

let rootDir: string;
let paths: DocsPathOverrides;
let syncSourcesRoot: string;

const identity: MemoryIdentity = {
  projectId: 'overdeck',
  workspaceId: 'feature-pan-2603',
  issueId: 'PAN-2603',
  runId: 'agent-pan-2603-work',
  sessionId: 'session-docs',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

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

function body(prompt: string, sessionId = 'session-docs'): Record<string, unknown> {
  return {
    prompt,
    sessionId,
    identity: { ...identity, sessionId },
  };
}

async function buildFixtureIndex(): Promise<void> {
  const config = docsConfig();
  await writeFixture('docs/guide.md', '# Guide\n\nPan harness docs explain workspace setup.\n');
  await buildDocsIndex({
    outputPath: paths.indexPath,
    rootDir,
    syncSourcesRoot,
    config,
    embeddingFn: deterministicDocsTestEmbedding,
  });
}

async function fastPath(prompt: string, config = docsConfig(), sessionId = 'session-docs') {
  return handleMemoryInjectFastPathBody(body(prompt, sessionId), {
    docsConfig: config,
    docsPaths: paths,
    resolveComplianceWarning: async () => 'compliance warning',
  });
}

describe('POST /api/memory/inject docs context fast path', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'pan-hooks-docs-inject-'));
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

  it('appends docs context for a trigger prompt and records one injection despite the fire-and-forget memory path', async () => {
    await buildFixtureIndex();
    expect(queryDocsIndex({ indexPath: paths.indexPath, query: 'pan harness docs' }).results.length).toBeGreaterThan(0);

    const result = await fastPath('pan harness docs');

    expect(result.ok).toBe(true);
    expect(result.context).toContain('compliance warning');
    expect(result.context).toContain('<overdeck-docs>');
    expect(result.context).toContain('docs/guide.md');

    await handleMemoryInjectBody(body('pan harness docs'), {
      resolveComplianceWarning: async () => null,
      injectMemory: async () => ({
        status: 'injected',
        context: 'slow memory context',
        decision: {} as never,
      }),
      injectBriefing: async (input) => ({ context: input.context, injected: false, briefingMtimeMs: null }),
    });

    const state = await readDocsBudgetState(paths);
    expect(state.records['session:session-docs'].injections).toHaveLength(1);
  });

  it('preserves compliance context without docs when prompt injection is disabled', async () => {
    await buildFixtureIndex();

    const result = await fastPath('pan harness docs', docsConfig({ promptInjectionEnabled: false }));

    expect(result).toEqual({ ok: true, context: 'compliance warning' });
  });

  it('preserves compliance context without docs for a non-trigger prompt', async () => {
    await buildFixtureIndex();

    const result = await fastPath('ordinary prompt', docsConfig({ trigger: { regexes: ['pan'] } }));

    expect(result).toEqual({ ok: true, context: 'compliance warning' });
  });

  it('preserves compliance context without docs when the index is missing', async () => {
    const result = await fastPath('pan harness docs', docsConfig(), 'missing-index');

    expect(result).toEqual({ ok: true, context: 'compliance warning' });
    const state = await readDocsBudgetState(paths);
    expect(state.records['session:missing-index'].injections).toEqual([]);
    await expect(readFile(paths.telemetryPath!, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
