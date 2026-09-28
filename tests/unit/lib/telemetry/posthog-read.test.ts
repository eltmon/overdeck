/** PAN-4264 Work Item 26: the PostHog read door for the doctor remote view. */
import { describe, expect, it, vi } from 'vitest';

import { listInstallsForOperator, posthogQueryHost } from '../../../../src/lib/telemetry/posthog-read.js';

const HASH = '0123456789abcdef';

function okResponse(results: unknown[]) {
  return new Response(JSON.stringify({ results }), { status: 200 });
}

describe('listInstallsForOperator (PAN-4264)', () => {
  it('sends the hash as a HogQL placeholder value, never inside the SQL', async () => {
    const fetchImpl = vi.fn(async () => okResponse([]));
    await listInstallsForOperator({
      operatorHash: HASH, readKey: 'phx_key', projectId: '42', host: 'https://us.posthog.com', ownDistinctId: 'me', fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://us.posthog.com/api/projects/42/query/');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer phx_key');
    const body = JSON.parse(String(init.body));
    expect(body.query.kind).toBe('HogQLQuery');
    expect(body.query.query).toContain('{operatorHash}');
    expect(body.query.query).not.toContain(HASH);
    expect(body.query.values).toEqual({ operatorHash: HASH });
  });

  it('drops this install and reads the last quota sample\'s GraphQL buckets', async () => {
    const fetchImpl = vi.fn(async () => okResponse([
      ['me-install-id', 'linux', 'x64', '0.62.1', '2026-09-27T15:00:00Z', '{"graphql_agent":"50-199"}'],
      ['mac-install-id', 'darwin', 'arm64', '0.62.0', '2026-09-27T14:00:00Z', JSON.stringify({ graphql_agent: '500-999', rest_agent: '0', platform: 'darwin' })],
      ['old-install-id', 'darwin', 'arm64', '0.61.0', '2026-09-26T10:00:00Z', null],
    ]));

    const installs = await listInstallsForOperator({
      operatorHash: HASH, readKey: 'k', projectId: '1', host: 'https://us.posthog.com', ownDistinctId: 'me-install-id', fetchImpl,
    });

    expect(installs).toEqual([
      { distinctId: 'mac-install-id', platform: 'darwin', arch: 'arm64', version: '0.62.0', lastSeen: '2026-09-27T14:00:00Z', lastQuotaSample: { graphql_agent: '500-999' } },
      { distinctId: 'old-install-id', platform: 'darwin', arch: 'arm64', version: '0.61.0', lastSeen: '2026-09-26T10:00:00Z', lastQuotaSample: null },
    ]);
  });

  it('returns [] on a network error or a non-2xx answer', async () => {
    const input = { operatorHash: HASH, readKey: 'k', projectId: '1', host: 'https://us.posthog.com', ownDistinctId: 'me' };
    await expect(listInstallsForOperator({ ...input, fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) })).resolves.toEqual([]);
    await expect(listInstallsForOperator({ ...input, fetchImpl: vi.fn(async () => new Response('no', { status: 403 })) })).resolves.toEqual([]);
  });

  it('derives the query host from the ingestion host', () => {
    expect(posthogQueryHost(undefined)).toBe('https://us.posthog.com');
    expect(posthogQueryHost('https://eu.i.posthog.com')).toBe('https://eu.posthog.com');
  });
});
