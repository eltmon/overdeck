import { describe, expect, it } from 'vitest';
import type { MemoryObservation } from '@panctl/contracts';
import {
  MEMORY_DOMAIN_TAGS,
  buildObservationPrompt,
  extractObservationFromTurn,
  type ExtractObservationCall,
} from '../../../src/lib/memory/extract.js';

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
  id: 'prev-1',
  timestamp: '2026-05-15T00:00:00.000Z',
  ...identity,
  gitBranch: 'feature/pan-1052',
  sourceTranscriptOffset: 10,
  actionStatus: 'Added memory contracts',
  narrative: 'Contracts landed.',
  summary: 'Memory contracts are available for downstream work.',
  files: ['packages/contracts/src/memory.ts'],
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
      usage: { input: 12, output: 6 },
      cost: { usd: 0 },
      model: 'stub-model',
      provider: 'stub',
    },
  };
}

describe('memory observation extractor', () => {
  it('builds an outcome-oriented prompt with continuity, null-actionStatus rule, and domain tags', () => {
    const prompt = buildObservationPrompt({
      compressedText: 'U: implement extractor\nA: wrote tests',
      identity,
      gitBranch: 'feature/pan-1052',
      sourceTranscriptOffset: 42,
      previousObservations: [previousObservation],
    });

    expect(prompt).toContain('Lead with outcomes');
    expect(prompt).toContain('set actionStatus to null');
    expect(prompt).toContain('Memory contracts are available for downstream work.');
    expect(prompt).toContain('Git branch: feature/pan-1052');
    for (const tag of MEMORY_DOMAIN_TAGS) expect(prompt).toContain(tag);
  });

  it('creates a MemoryObservation from a valid provider payload', async () => {
    const extract: ExtractObservationCall = async () => extracted({
      narrative: 'Implemented the observation extractor and tests.',
      summary: 'src/lib/memory/extract.ts now builds activity observations.',
      actionStatus: 'Implemented observation extractor',
      tags: ['handoff'],
      files: ['src/lib/memory/extract.ts'],
    });

    const result = await extractObservationFromTurn({
      compressedText: 'U: implement extractor\nA: done',
      identity,
      gitBranch: 'feature/pan-1052',
      sourceTranscriptOffset: 123,
      now: new Date('2026-05-15T00:00:00.000Z'),
      id: 'obs-1',
      extract,
    });

    expect(result.status).toBe('extracted');
    if (result.status === 'extracted') {
      expect(result.observation).toMatchObject({
        id: 'obs-1',
        timestamp: '2026-05-15T00:00:00.000Z',
        issueId: 'PAN-1052',
        actionStatus: 'Implemented observation extractor',
        sourceTranscriptOffset: 123,
        tokens: { prompt: 12, completion: 6, total: 18 },
        model: 'stub-model',
      });
    }
  });

  it('retries once after a malformed provider response', async () => {
    let calls = 0;
    const extract: ExtractObservationCall = async () => {
      calls += 1;
      if (calls === 1) return extracted({ summary: 'missing fields' });
      return extracted({
        narrative: 'Second attempt succeeded.',
        summary: 'Observation payload is valid after retry.',
        actionStatus: null,
        tags: [],
        files: [],
      });
    };

    const result = await extractObservationFromTurn({
      compressedText: 'U: discuss\nA: ok',
      identity,
      gitBranch: 'feature/pan-1052',
      sourceTranscriptOffset: 10,
      extract,
    });

    expect(calls).toBe(2);
    expect(result.status).toBe('extracted');
  });

  it('drops after two malformed provider responses', async () => {
    const extract: ExtractObservationCall = async () => extracted({ summary: 'still missing fields' });

    const result = await extractObservationFromTurn({
      compressedText: 'U: discuss\nA: ok',
      identity,
      gitBranch: 'feature/pan-1052',
      sourceTranscriptOffset: 10,
      extract,
    });

    expect(result).toEqual({ status: 'dropped', reason: 'malformed-response' });
  });
});
