import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation } from '@panctl/contracts';
import {
  buildQueryExpansionCacheKey,
  buildQueryExpansionPrompt,
  clearQueryExpansionCache,
  expandMemoryQuery,
  type QueryExpansionCall,
} from '../../../src/lib/memory/query-expansion.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

const previousObservation: MemoryObservation = {
  id: 'obs-1',
  timestamp: '2026-05-15T00:00:00.000Z',
  ...identity,
  gitBranch: 'feature/pan-1052',
  sourceTranscriptOffset: 10,
  actionStatus: 'Implemented extraction providers',
  narrative: 'Provider registry is in place.',
  summary: 'Memory provider registry supports Anthropic and cliproxy.',
  files: ['src/lib/memory/providers/index.ts'],
  tags: ['architecture-decision'],
  tokens: { prompt: 1, completion: 1, total: 2 },
  model: 'stub-model',
};

function extracted(data: unknown) {
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data,
      usage: { input: 4, output: 2 },
      cost: { usd: 0 },
      model: 'stub-model',
      provider: 'stub',
    },
  };
}

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-query-expansion-'));
  process.env.PANOPTICON_HOME = tempDir;
  clearQueryExpansionCache();
});

afterEach(async () => {
  clearQueryExpansionCache();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('memory query expansion', () => {
  it('builds a BM25-focused prompt from the user prompt and last three observations', () => {
    const prompt = buildQueryExpansionPrompt({
      prompt: 'How did memory extraction providers land?',
      identity,
      previousObservations: [previousObservation],
    });

    expect(prompt).toContain('3-5 concise BM25 search terms');
    expect(prompt).toContain('How did memory extraction providers land?');
    expect(prompt).toContain('Memory provider registry supports Anthropic and cliproxy.');
    expect(prompt).toContain('src/lib/memory/providers/index.ts');
  });

  it('expands to normalized terms, caches by session and content hash, and logs rag-runs entries', async () => {
    let calls = 0;
    const expand: QueryExpansionCall = async () => {
      calls += 1;
      return extracted({ terms: [' provider registry ', 'Anthropic SDK', 'provider registry', 'cliproxy memory', 'extra', 'ignored'] });
    };

    const first = await expandMemoryQuery({
      prompt: 'find provider work',
      identity,
      previousObservations: [previousObservation],
      now: new Date('2026-05-16T20:00:00.000Z'),
      id: 'run-1',
      expand,
    });
    const second = await expandMemoryQuery({
      prompt: 'find provider work',
      identity,
      previousObservations: [previousObservation],
      now: new Date('2026-05-16T20:01:00.000Z'),
      id: 'run-2',
      expand,
    });

    expect(calls).toBe(1);
    expect(first).toMatchObject({
      query: 'provider registry Anthropic SDK cliproxy memory extra ignored',
      expandedTerms: ['provider registry', 'Anthropic SDK', 'cliproxy memory', 'extra', 'ignored'],
      status: 'expanded',
      reason: null,
    });
    expect(second).toMatchObject({
      query: first.query,
      expandedTerms: first.expandedTerms,
      status: 'cache-hit',
      reason: null,
    });
    expect(first.cacheKey).toBe(buildQueryExpansionCacheKey({
      prompt: 'find provider work',
      identity,
      previousObservations: [previousObservation],
    }));

    const ragRuns = await readFile(join(tempDir!, 'memory/panopticon-cli/PAN-1052/rag-runs/2026-05-16.jsonl'), 'utf8');
    const entries = ragRuns.trim().split('\n').map((line) => JSON.parse(line));
    expect(entries).toMatchObject([
      { id: 'run-1', type: 'query-expansion', outcome: 'expanded', query: first.query, expandedTerms: first.expandedTerms, reason: null },
      { id: 'run-2', type: 'query-expansion', outcome: 'cache-hit', query: first.query, expandedTerms: first.expandedTerms, reason: null },
    ]);
  });

  it('falls back to the raw prompt and logs expansion-failed when the provider fails', async () => {
    const result = await expandMemoryQuery({
      prompt: 'raw search text',
      identity,
      now: new Date('2026-05-16T20:00:00.000Z'),
      id: 'failed-run',
      expand: async () => ({ status: 'dropped', reason: 'extraction-failed', error: new Error('provider failed') }),
    });

    expect(result).toMatchObject({
      query: 'raw search text',
      expandedTerms: [],
      status: 'fallback',
      reason: 'extraction-failed',
    });

    const ragRuns = await readFile(join(tempDir!, 'memory/panopticon-cli/PAN-1052/rag-runs/2026-05-16.jsonl'), 'utf8');
    expect(JSON.parse(ragRuns.trim())).toMatchObject({
      id: 'failed-run',
      outcome: 'expansion-failed',
      query: 'raw search text',
      expandedTerms: [],
      reason: 'extraction-failed',
    });
  });

  it('falls back to the raw prompt when the provider returns malformed terms', async () => {
    const result = await expandMemoryQuery({
      prompt: 'raw malformed search',
      identity,
      expand: async () => extracted({ terms: [] }),
      logDecision: async () => undefined,
    });

    expect(result).toMatchObject({
      query: 'raw malformed search',
      expandedTerms: [],
      status: 'fallback',
      reason: 'malformed-response',
    });
  });
});
