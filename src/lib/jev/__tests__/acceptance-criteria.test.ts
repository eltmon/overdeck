import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Fetch } from '@typesafe-ai/sdk';
import type { CostEvent } from '../../costs/events.js';

// Capture cost events instead of writing them to the JSONL/SQLite ledger.
const captured: CostEvent[] = [];
vi.mock('../../costs/events.js', () => ({
  appendCostEvent: (event: CostEvent) => {
    captured.push(event);
  },
}));

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV, type NormalizedJevConfig } from '../../config-yaml/jev.js';
import type { JevConfigInput } from '../config.js';
import { resetJevMemo } from '../memo.js';
import { buildAcceptanceCriteriaRequest, reviewAcceptanceCriteria } from '../acceptance-criteria.js';
import type { XBriefDocument, XBriefItem } from '../../xbrief/types.js';

const FEATURE = 'jevAcceptanceCriteriaReview';

function config(opts: { enabled?: boolean; jev?: Partial<NormalizedJevConfig> } = {}): JevConfigInput {
  return {
    backgroundAi: {
      cheapMode: false,
      features: { ...defaultBackgroundAiFeatures(), [FEATURE]: opts.enabled ?? true },
    },
    jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x', ...opts.jev },
    apiKeys: { typesafe: 'k' },
  };
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(respond: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn<Fetch>(async (url, init) => {
    const call = { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  });
  return { fetch, calls };
}

function ac(id: string, title: string) {
  return {
    id,
    title,
    status: 'pending' as const,
    metadata: { kind: 'acceptance_criterion' },
  };
}

function item(overrides: Partial<XBriefItem> = {}): XBriefItem {
  const id = overrides.id ?? 'item-1';
  return {
    id,
    title: 'Implement behavior',
    status: 'pending',
    subItems: [ac(`${id}.ac1`, 'Given a valid request then it returns success')],
    ...overrides,
  };
}

function doc(items: XBriefItem[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-06-12T00:00:00Z' },
    plan: {
      id: 'PAN-4372',
      title: 'Plan',
      status: 'proposed',
      items,
      edges: [],
    },
  };
}

const tmpDirs: string[] = [];
async function tmpHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jev-ac-review-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  resetJevMemo();
  captured.length = 0;
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('buildAcceptanceCriteriaRequest (PAN-4372)', () => {
  it('drops ACs from cancelled items and de-dupes repeated ids (first wins)', () => {
    const plan = doc([
      item({ id: 'item-1', subItems: [ac('ac1', 'First title'), ac('dup', 'Kept title')] }),
      item({ id: 'item-2', status: 'cancelled' }),
      item({ id: 'item-3', subItems: [ac('dup', 'Dropped title')] }),
    ]);
    const request = buildAcceptanceCriteriaRequest(plan);
    expect(request.criteria.map(c => c.acId)).toEqual(['ac1', 'dup']);
    expect(request.state.criteria).toEqual({ ac1: 'First title', dup: 'Kept title' });
  });
});

describe('reviewAcceptanceCriteria (PAN-4372)', () => {
  it('returns unavailable with no request when the toggle is off', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ model: 'test-model-x', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }),
    );
    const plan = doc([item()]);
    const result = await reviewAcceptanceCriteria(plan, { config: config({ enabled: false }), fetch, env: {} });
    expect(result).toEqual({ status: 'unavailable', reason: 'disabled', issues: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends one request for every non-cancelled AC across items', async () => {
    const plan = doc([
      item({ id: 'item-1', subItems: [ac('item-1.ac1', 'A'), ac('item-1.ac2', 'B')] }),
      item({ id: 'item-2', status: 'cancelled', subItems: [ac('item-2.ac1', 'Ignored')] }),
      item({ id: 'item-3', subItems: [ac('item-3.ac1', 'C'), ac('item-3.ac2', 'D')] }),
    ]);
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse({ model: 'test-model-x', answers: {}, usage: { input_tokens: 40, output_tokens: 0 } }),
    );
    const result = await reviewAcceptanceCriteria(plan, { config: config(), fetch, env: {}, evalLogHome: await tmpHome() });
    expect(fetch).toHaveBeenCalledTimes(1);
    const expectedIds = ['item-1.ac1', 'item-1.ac2', 'item-3.ac1', 'item-3.ac2'];
    const expectedKeys = expectedIds.flatMap(id => [`observable_${id}`, `compound_${id}`]).sort();
    expect(Object.keys(calls[0].body.questions as Record<string, unknown>).sort()).toEqual(expectedKeys);
    expect(result.status).toBe('answered');
  });

  it('warns ac-semantic-not-observable below the threshold and ac-semantic-compound above it', async () => {
    const plan = doc([item({ id: 'item-1', subItems: [ac('ac1', 'Some title')] })]);
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        model: 'test-model-x',
        answers: {
          observable_ac1: { type: 'noul', noul: 0.1 },
          compound_ac1: { type: 'noul', noul: 0.9 },
        },
        usage: { input_tokens: 40, output_tokens: 0 },
      }),
    );
    const result = await reviewAcceptanceCriteria(plan, { config: config(), fetch, env: {}, evalLogHome: await tmpHome() });
    expect(result.status).toBe('answered');
    if (result.status !== 'answered') throw new Error('unreachable');
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every(issue => issue.severity === 'warn')).toBe(true);
    expect(result.issues.map(issue => issue.rule).sort()).toEqual(['ac-semantic-compound', 'ac-semantic-not-observable']);
    expect(result.issues.every(issue => issue.itemId === 'item-1')).toBe(true);
    expect(result.issues.find(issue => issue.rule === 'ac-semantic-not-observable')?.message).toContain('ac1');
  });

  it('returns skipped without calling assess when no AC is active', async () => {
    const plan = doc([item({ id: 'item-1', subItems: [] })]);
    const { fetch } = fakeFetch(() =>
      jsonResponse({ model: 'test-model-x', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }),
    );
    const result = await reviewAcceptanceCriteria(plan, { config: config(), fetch, env: {} });
    expect(result).toEqual({ status: 'skipped', reason: 'no-acceptance-criteria', issues: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns failed with no issues when the request errors', async () => {
    const plan = doc([item()]);
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'nope' }, 500));
    const result = await reviewAcceptanceCriteria(plan, { config: config(), fetch, env: {} });
    expect(result).toEqual({ status: 'failed', reason: 'server-error', issues: [] });
  });
});
