import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPushConfig, type NormalizedNtfyConfig } from '../../../../src/lib/config-yaml/push-config.js';
import { createNtfyProvider } from '../../../../src/lib/push/ntfy-provider.js';
import type { NeedsYouNotification } from '../../../../src/lib/push/types.js';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const notification: NeedsYouNotification = {
  kind: 'question',
  category: 'question',
  tag: 'auq:toolu_01',
  title: 'Question · Private conversation title',
  publicTitle: 'Question · a conversation',
  body: 'Tap to answer. Private preview text',
  url: '/m?subject=my-conv',
  issueId: null,
  ts: '2026-11-01T00:00:00.000Z',
};

function recordingFetch(statuses: number[]): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch, ntfy: NormalizedNtfyConfig) {
  return createNtfyProvider({ fetchImpl, readConfig: () => ({ ...defaultPushConfig(), ntfy }) });
}

const ready: NormalizedNtfyConfig = {
  state: 'ready',
  url: 'https://ntfy.example.net/',
  topic: 'deck-k3J9xQ2mV7pL4sTa',
  token: null,
  clickBaseUrl: null,
};

describe('ntfy provider (PAN-2354)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the public title only: never the Web Push title or the body', async () => {
    const { fetchImpl, calls } = recordingFetch([200]);
    const outcomes = await provider(fetchImpl, ready).send(notification);
    expect(outcomes).toEqual([{ target: 'ntfy:ntfy.example.net', ok: true }]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://ntfy.example.net/deck-k3J9xQ2mV7pL4sTa');
    expect(call.body).toBe(notification.publicTitle);
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('Private conversation title');
    expect(serialized).not.toContain('Private preview text');
    expect(Buffer.from(call.headers['Title']!.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8'))
      .toBe(notification.publicTitle);
    expect(call.headers['Priority']).toBe('4');
    expect(call.headers['Tags']).toBe('question');
  });

  it('sends no Click header without clickBaseUrl, and one with it', async () => {
    const without = recordingFetch([200]);
    await provider(without.fetchImpl, ready).send(notification);
    expect(without.calls[0]!.headers['Click']).toBeUndefined();

    const withClick = recordingFetch([200]);
    await provider(withClick.fetchImpl, { ...ready, clickBaseUrl: 'https://desk.tailnet.ts.net' }).send(notification);
    expect(withClick.calls[0]!.headers['Click']).toBe('https://desk.tailnet.ts.net/m?subject=my-conv');
  });

  it('sends an Authorization header only with a token', async () => {
    const without = recordingFetch([200]);
    await provider(without.fetchImpl, ready).send(notification);
    expect(without.calls[0]!.headers['Authorization']).toBeUndefined();

    const withToken = recordingFetch([200]);
    await provider(withToken.fetchImpl, { ...ready, token: 'tk_secret' }).send(notification);
    expect(withToken.calls[0]!.headers['Authorization']).toBe('Bearer tk_secret');
  });

  it('has no targets and sends nothing when ntfy is off', async () => {
    const { fetchImpl, calls } = recordingFetch([]);
    const p = provider(fetchImpl, { state: 'off' });
    expect(await p.hasTargets()).toBe(false);
    expect(await p.send(notification)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('retries a 500 once after 5 s', async () => {
    const { fetchImpl, calls } = recordingFetch([500, 200]);
    const pending = provider(fetchImpl, ready).send(notification);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([{ target: 'ntfy:ntfy.example.net', ok: true }]);
    expect(calls).toHaveLength(2);
  });

  it('reports a 403 as rejected without a retry', async () => {
    const { fetchImpl, calls } = recordingFetch([403]);
    const outcomes = await provider(fetchImpl, ready).send(notification);
    expect(outcomes).toEqual([{ target: 'ntfy:ntfy.example.net', ok: false, reason: 'rejected', status: 403 }]);
    expect(calls).toHaveLength(1);
  });
});
