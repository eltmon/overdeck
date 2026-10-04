import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '@typesafe-ai/sdk';
import type { CostEvent } from '../../costs/events.js';
import type { JevUsageRow } from '../usage-log.js';

// Capture cost events instead of writing them to the JSONL/SQLite ledger.
const captured: CostEvent[] = [];
vi.mock('../../costs/events.js', () => ({
  appendCostEvent: (event: CostEvent) => {
    captured.push(event);
  },
}));

// Capture usage-log rows instead of writing them to disk.
const capturedUsage: JevUsageRow[] = [];
vi.mock('../usage-log.js', () => ({
  appendJevUsage: (row: JevUsageRow) => {
    capturedUsage.push(row);
  },
}));

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV, type NormalizedJevConfig } from '../../config-yaml/jev.js';
import { assess, createJevClient } from '../client.js';
import type { JevConfigInput } from '../config.js';
import { resetJevMemo } from '../memo.js';
import { JEV_SMOKE_QUESTIONS } from '../questions.js';

const FEATURE = 'jevTurnEndAssessment';
const STATE = 'I finished the parser. Should I also migrate the old callers?';

function config(opts: { cheapMode?: boolean; jev?: Partial<NormalizedJevConfig>; key?: string } = {}): JevConfigInput {
  return {
    backgroundAi: {
      cheapMode: opts.cheapMode ?? false,
      features: { ...defaultBackgroundAiFeatures(), [FEATURE]: true },
    },
    jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x', ...opts.jev },
    apiKeys: { typesafe: opts.key ?? 'k' },
  };
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake fetch that records calls and answers with `respond`. */
function fakeFetch(respond: (call: FetchCall, init?: RequestInit) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn<Fetch>(async (url, init) => {
    const call = { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call, init);
  });
  return { fetch, calls };
}

function answeredFetch(model = 'test-model-x', usage = { input_tokens: 120, output_tokens: 0 }) {
  return fakeFetch(() =>
    jsonResponse({ model, answers: { asks_question: { type: 'noul', noul: 0.93 } }, usage }),
  );
}

beforeEach(() => {
  resetJevMemo();
  captured.length = 0;
  capturedUsage.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('assess() gates (PAN-4369)', () => {
  it('returns unavailable/disabled in cheap mode without a request', async () => {
    const { fetch } = answeredFetch();
    const result = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config({ cheapMode: true }), fetch, env: {} });
    expect(result).toEqual({ status: 'unavailable', reason: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns unavailable/not-configured without a jev block', async () => {
    const { fetch } = answeredFetch();
    const result = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, {
      config: config({ jev: { configured: false } }),
      fetch,
      env: {},
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'not-configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns unavailable/model-not-configured even when the SDK default-model env var is set', async () => {
    const { fetch } = answeredFetch();
    const result = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, {
      config: config({ jev: { model: undefined } }),
      fetch,
      env: { TYPESAFE_DEFAULT_MODEL: 'jev-latest' },
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'model-not-configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('assess() requests (PAN-4369)', () => {
  it('sends the configured model to <base_url>/v1/systemone', async () => {
    const { fetch, calls } = answeredFetch();
    const result = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, {
      config: config({ jev: { baseUrl: 'https://opencode.ai/zen' } }),
      fetch,
      env: {},
    });
    expect(result.status).toBe('answered');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://opencode.ai/zen/v1/systemone');
    expect(calls[0].body.model).toBe('test-model-x');
    expect(calls[0].body.state).toBe(STATE);
  });

  it('returns the answers, served model and usage', async () => {
    const { fetch } = answeredFetch('jev-1.13-free');
    const result = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(result).toEqual({
      status: 'answered',
      answers: { asks_question: { type: 'noul', noul: 0.93 } },
      model: 'jev-1.13-free',
      usage: { input_tokens: 120, output_tokens: 0 },
    });
  });
});

describe('assess() failures never reject (PAN-4369)', () => {
  it.each([
    [401, 'auth-failed'],
    [403, 'auth-failed'],
    [429, 'rate-limited'],
    [400, 'bad-request'],
    [422, 'bad-request'],
    [503, 'server-error'],
  ])('maps HTTP %i to failed/%s', async (status, reason) => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'nope' }, status));
    const promise = assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    await expect(promise).resolves.toMatchObject({ status: 'failed', reason });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a transport failure to failed/connection-error', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(
      assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'connection-error' });
  });

  it('maps a caller abort to failed/aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch } = fakeFetch((_call, init) =>
      Promise.reject(init?.signal?.reason ?? new Error('aborted')),
    );
    await expect(
      assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {}, signal: controller.signal }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'aborted' });
  });

  it('maps a request that outlives timeoutMs to failed/timeout', async () => {
    vi.useFakeTimers();
    let markCalled!: () => void;
    const called = new Promise<void>((resolve) => {
      markCalled = resolve;
    });
    const { fetch } = fakeFetch(
      (_call, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true });
          markCalled();
        }),
    );
    const promise = assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, {
      config: config({ jev: { timeoutMs: 2000 } }),
      fetch,
      env: {},
    });
    await called;
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('does not memoize a failure', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'slow down' }, 429));
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('assess() memo and dedupe (PAN-4369)', () => {
  it('serves a repeated request from the memo', async () => {
    const { fetch } = answeredFetch();
    const first = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    const second = await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('answered');
    expect(second).toEqual(first);
  });

  it('shares one request between concurrent identical calls', async () => {
    const { fetch } = answeredFetch();
    const [a, b] = await Promise.all([
      assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} }),
      assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('answered');
    expect(b.status).toBe('answered');
  });
});

describe('assess() cost recording (PAN-4369)', () => {
  it('records one zero-cost event for jev-1.13-free and none on a memo hit', async () => {
    const { fetch } = answeredFetch('jev-1.13-free');
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      source: 'background:jevTurnEndAssessment',
      provider: 'custom',
      model: 'jev-1.13-free',
      cost: 0,
      input: 120,
      output: 0,
    });
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(captured).toHaveLength(1);
  });

  it('prices jev-1.13 at 0.042 per million input tokens', async () => {
    const { fetch } = answeredFetch('jev-1.13', { input_tokens: 1_000_000, output_tokens: 0 });
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(captured).toHaveLength(1);
    expect(captured[0].cost).toBe(0.042);
  });

  it('records nothing for a failed call', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'bad key' }, 401));
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(captured).toHaveLength(0);
  });
});

describe('assess() usage log (PAN-4508)', () => {
  it('appends exactly one answered row for a real request', async () => {
    const { fetch } = answeredFetch('jev-1.13-free');
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(capturedUsage).toHaveLength(1);
    expect(capturedUsage[0]).toMatchObject({ feature: FEATURE, outcome: 'answered', model: 'jev-1.13-free' });
  });

  it('appends exactly one failed row with the HTTP status on a 401', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'bad key' }, 401));
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(capturedUsage).toHaveLength(1);
    expect(capturedUsage[0]).toMatchObject({ feature: FEATURE, outcome: 'failed', reason: 'auth-failed', status: 401 });
  });

  it('appends nothing for a memo hit or an unavailable result', async () => {
    const { fetch } = answeredFetch();
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(capturedUsage).toHaveLength(1);
    capturedUsage.length = 0;

    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config(), fetch, env: {} });
    expect(capturedUsage).toHaveLength(0);

    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config({ cheapMode: true }), fetch, env: {} });
    expect(capturedUsage).toHaveLength(0);
  });

  it('never records the API key or the state text', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: 'bad key' }, 401));
    await assess(FEATURE, STATE, JEV_SMOKE_QUESTIONS, { config: config({ key: 'super-secret-key' }), fetch, env: {} });
    const serialized = JSON.stringify(capturedUsage);
    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain(STATE);
  });
});

describe('createJevClient (PAN-4369)', () => {
  it('pins logLevel to warn even when TYPESAFE_LOG_LEVEL=debug', () => {
    vi.stubEnv('TYPESAFE_LOG_LEVEL', 'debug');
    const client = createJevClient({ apiKey: 'k', model: 'test-model-x', timeoutMs: 2000 });
    expect(client.logLevel).toBe('warn');
    expect(client.defaultModel).toBe('test-model-x');
  });
});
