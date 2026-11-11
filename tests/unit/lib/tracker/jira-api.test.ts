import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackerError } from '../../../../src/lib/errors.js';
import { IssueNotFoundError, TrackerAuthError } from '../../../../src/lib/tracker/interface.js';
import {
  JiraRestApi,
  apiPath,
  detectJiraDeployment,
  normalizeJiraSite,
} from '../../../../src/lib/tracker/jira-api.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function failureOf<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JiraRestApi.request', () => {
  it('retries a 429 only after Retry-After elapses and returns the second body', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ key: 'PROJ-1' }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const result = Effect.runPromise(api.api<{ key: string }>('GET', '/issue/PROJ-1'));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ key: 'PROJ-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails with a rate-limit TrackerError after three retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const pending = failureOf(api.api('GET', '/myself'));
    await vi.advanceTimersByTimeAsync(3000);
    const error = await pending;
    expect(error).toBeInstanceOf(TrackerError);
    expect((error as TrackerError).message).toContain('rate limited');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('maps a 401 to TrackerAuthError naming the fix and never the token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const error = await failureOf(api.api('GET', '/myself'));
    expect(error).toBeInstanceOf(TrackerAuthError);
    expect((error as TrackerAuthError).message).toContain('JIRA_API_TOKEN');
    expect((error as TrackerAuthError).message).not.toContain(fakeToken);
  });

  it('sends Basic auth and the v3 prefix on Cloud', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const api = new JiraRestApi({ site: 'https://acme.atlassian.net/', token: fakeToken, email: 'dev@example.com', fetchImpl });

    await Effect.runPromise(api.api('GET', '/myself'));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(headerOf(init, 'Authorization')).toBe(`Basic ${Buffer.from(`dev@example.com:${fakeToken}`).toString('base64')}`);
  });

  it('sends Bearer auth and the v2 prefix on Data Center', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    await Effect.runPromise(api.api('GET', '/myself'));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://jira.example.com/rest/api/2/myself');
    expect(headerOf(init, 'Authorization')).toBe(`Bearer ${fakeToken}`);
  });

  it('refuses Cloud requests without an email', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const api = new JiraRestApi({ site: 'https://acme.atlassian.net', token: fakeToken, fetchImpl });

    const error = await failureOf(api.api('GET', '/myself'));
    expect(error).toBeInstanceOf(TrackerAuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts a hung request after 30 s with a TrackerError', async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const pending = failureOf(api.api('GET', '/myself'));
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await pending;
    expect(error).toBeInstanceOf(TrackerError);
    expect((error as TrackerError).message).toContain('timed out');
    expect(signal?.aborted).toBe(true);
  });

  it('maps a 404 on an issue path to IssueNotFoundError', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 404 }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const error = await failureOf(api.api('GET', '/issue/PROJ-9?fields=summary'));
    expect(error).toBeInstanceOf(IssueNotFoundError);
    expect((error as IssueNotFoundError).id).toBe('PROJ-9');
  });

  it('reports other failures with method, path and status only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('boom', { status: 500 }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    const error = await failureOf(api.api('POST', '/issue/PROJ-1/comment', { body: 'x' }));
    expect(error).toBeInstanceOf(TrackerError);
    expect((error as TrackerError).message).toBe('Jira POST /rest/api/2/issue/PROJ-1/comment failed: 500');
  });

  it('resolves undefined for 204', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const api = new JiraRestApi({ site: 'https://jira.example.com', token: fakeToken, deployment: 'datacenter', fetchImpl });

    await expect(Effect.runPromise(api.api('POST', '/issue/PROJ-1/transitions', { transition: { id: '1' } }))).resolves.toBeUndefined();
  });
});

describe('site normalization and paths', () => {
  it('trims trailing slashes and requires a scheme', () => {
    expect(normalizeJiraSite(' https://acme.atlassian.net// ')).toBe('https://acme.atlassian.net');
    expect(() => normalizeJiraSite('acme.atlassian.net')).toThrow(TrackerAuthError);
  });

  it('prefixes v3 for Cloud and v2 for Data Center', () => {
    expect(apiPath('cloud', '/search/jql')).toBe('/rest/api/3/search/jql');
    expect(apiPath('datacenter', 'search')).toBe('/rest/api/2/search');
  });
});

describe('detectJiraDeployment', () => {
  it('treats atlassian.net as Cloud without a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(detectJiraDeployment('https://x.atlassian.net', fetchImpl)).resolves.toBe('cloud');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads deploymentType from serverInfo and caches it per site', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ deploymentType: 'Server' }));
    await expect(detectJiraDeployment('https://jira-server.example.com', fetchImpl)).resolves.toBe('datacenter');
    await expect(detectJiraDeployment('https://jira-server.example.com', fetchImpl)).resolves.toBe('datacenter');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://jira-server.example.com/rest/api/2/serverInfo');
  });

  it('detects Cloud on a custom domain', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ deploymentType: 'Cloud' }));
    await expect(detectJiraDeployment('https://jira.custom-cloud.example.com', fetchImpl)).resolves.toBe('cloud');
  });

  it('falls back to Data Center when the probe fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('offline'); });
    await expect(detectJiraDeployment('https://jira-offline.example.com', fetchImpl)).resolves.toBe('datacenter');
  });
});
