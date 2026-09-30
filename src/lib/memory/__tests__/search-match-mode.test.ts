/**
 * PAN-4370 search-match-mode: `searchMemory` gains `matchMode` and
 * `buildPromptKeywordQuery` (WI-1). `buildMatchQuery` defaults to ANDing every
 * quoted term (unchanged `pan memory search` behavior); prompt-time injection
 * (WI-2) needs OR mode plus a stopword-filtered keyword query so a long raw
 * prompt can still hit a matching observation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation, MemoryIdentity } from '@overdeck/contracts';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';
import { searchMemory, buildMatchQuery, buildPromptKeywordQuery } from '../search.js';
import { writeObservation } from '../observations.js';
import { closeMemoryFtsDatabases } from '../fts-db.js';

const LONG_PROMPT = 'Fix the review agent so it posts findings to the PR before the verification gate times out';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  closeMemoryFtsDatabases();
  teardownOverdeckTestDb(odb);
});

function baseIdentity(overrides: Partial<MemoryIdentity> = {}): MemoryIdentity {
  return {
    projectId: 'overdeck',
    workspaceId: 'workspace-x',
    issueId: null,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'conversation',
    agentHarness: 'claude-code',
    ...overrides,
  };
}

function observation(identity: MemoryIdentity, overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-07-28T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: null,
    narrative: overrides.narrative ?? 'A search-match-mode turn.',
    summary: overrides.summary ?? 'search-match-mode summary',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

describe('buildPromptKeywordQuery', () => {
  it('drops stopwords and short tokens, lowercases, and preserves order', () => {
    expect(buildPromptKeywordQuery(LONG_PROMPT)).toBe(
      'fix review agent posts findings verification gate times',
    );
  });

  it('caps at 12 terms and dedupes case-insensitively', () => {
    const text = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Omega Sigma Tau alpha BETA';
    const result = buildPromptKeywordQuery(text);
    const terms = result.split(' ');
    expect(terms).toHaveLength(12);
    expect(terms).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'omega']);
  });
});

describe('buildMatchQuery', () => {
  it('defaults to ANDing quoted terms', () => {
    expect(buildMatchQuery('a b')).toBe('"a" "b"');
  });

  it('ORs quoted terms in "any" mode', () => {
    expect(buildMatchQuery('a b', 'any')).toBe('"a" OR "b"');
  });
});

describe('searchMemory matchMode', () => {
  it('returns 0 hits for a long raw prompt in default mode, and the matching observation first in "any" mode over the keyword query', async () => {
    const identity = baseIdentity();
    await writeObservation(observation(identity, {
      id: 'matching',
      narrative: 'Addressed blocking review findings after the verification gate failed',
    }));
    await writeObservation(observation(identity, {
      id: 'unrelated',
      narrative: 'Tuned terminal theme colors',
    }));

    const defaultHits = await searchMemory({
      query: LONG_PROMPT,
      projectId: identity.projectId,
      workspaceId: identity.workspaceId,
    });
    expect(defaultHits).toEqual([]);

    const anyHits = await searchMemory({
      query: buildPromptKeywordQuery(LONG_PROMPT),
      projectId: identity.projectId,
      workspaceId: identity.workspaceId,
      matchMode: 'any',
    });
    expect(anyHits[0]?.source).toBe('matching');
  });
});
