/**
 * PAN-5165 WI-7: pan doctor's Atlassian MCP row, with injected deps and a fake
 * fetchImpl (no network, no real timers).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAtlassianMcp } from '../doctor-atlassian.js';

const COMMIT = 'f'.repeat(40);

function jsonFetch(status: number, headersSeen?: { value: HeadersInit | undefined }): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (headersSeen) headersSeen.value = init?.headers;
    return { ok: status >= 200 && status < 300, status } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkAtlassianMcp (PAN-5165)', () => {
  it('returns [] and calls fetchImpl zero times when the pack is not registered', async () => {
    const fetchImpl = vi.fn();
    const checks = await checkAtlassianMcp({
      getPack: async () => null,
      packOnSomewhere: async () => true,
      trackerKeys: async () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(checks).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns one ok row and calls fetchImpl zero times when the pack is registered but off everywhere', async () => {
    const fetchImpl = vi.fn();
    const checks = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => false,
      trackerKeys: async () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(checks).toEqual([{ name: 'Atlassian MCP', status: 'ok', message: 'atlassian pack registered and off everywhere; endpoint not checked' }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the Basic header for the configured Jira email and token, and reports ok on 2xx', async () => {
    const headersSeen: { value: HeadersInit | undefined } = { value: undefined };
    const checks = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => ({ jira: 't0k', jiraEmail: 'a@b.com' }),
      fetchImpl: jsonFetch(200, headersSeen),
    });
    expect((headersSeen.value as Record<string, string>).Authorization).toBe('Basic YUBiLmNvbTp0MGs=');
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe('ok');
    expect(checks[0]!.message).toContain('Signed in with the Jira API token');
    expect(JSON.stringify(checks[0])).not.toContain('t0k');
  });

  it('reports an error row with the mcp_servers escape when the token is rejected (401/403)', async () => {
    for (const status of [401, 403]) {
      const checks = await checkAtlassianMcp({
        getPack: async () => ({ commit: COMMIT }),
        packOnSomewhere: async () => true,
        trackerKeys: async () => ({ jira: 't0k', jiraEmail: 'a@b.com' }),
        fetchImpl: jsonFetch(status),
      });
      expect(checks[0]!.status).toBe('error');
      expect(checks[0]!.message).toBe(`Atlassian rejected the Jira API token (HTTP ${status})`);
      expect(checks[0]!.fix).toContain('mcp_servers entry named atlassian');
      expect(checks[0]!.fix).not.toContain('remove JIRA');
      expect(JSON.stringify(checks[0])).not.toContain('t0k');
    }
  });

  it('warns "not signed in" with no credentials on a 401, naming JIRA_EMAIL, JIRA_API_TOKEN and /mcp', async () => {
    const checks = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => undefined,
      fetchImpl: jsonFetch(401),
    });
    expect(checks[0]!.status).toBe('warn');
    expect(checks[0]!.message).toContain('Atlassian MCP not signed in');
    expect(checks[0]!.fix).toContain('JIRA_EMAIL');
    expect(checks[0]!.fix).toContain('JIRA_API_TOKEN');
    expect(checks[0]!.fix).toContain('/mcp');
  });

  it('reports ok when the header-less endpoint answers 2xx', async () => {
    const checks = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => undefined,
      fetchImpl: jsonFetch(200),
    });
    expect(checks[0]!.status).toBe('ok');
    expect(checks[0]!.message).toContain('endpoint answered (HTTP 200)');
  });

  it('warns on any other status, with or without credentials', async () => {
    const withoutCreds = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => undefined,
      fetchImpl: jsonFetch(500),
    });
    expect(withoutCreds[0]).toEqual({ name: 'Atlassian MCP', status: 'warn', message: 'Atlassian MCP endpoint answered HTTP 500' });

    const withCreds = await checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => ({ jira: 't0k', jiraEmail: 'a@b.com' }),
      fetchImpl: jsonFetch(500),
    });
    expect(withCreds[0]).toEqual({ name: 'Atlassian MCP', status: 'warn', message: 'Atlassian MCP endpoint answered HTTP 500' });
  });

  it('aborts at the timeout and reports the endpoint unreachable, never the token (fake timers)', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
      })) as unknown as typeof fetch;

    const pending = checkAtlassianMcp({
      getPack: async () => ({ commit: COMMIT }),
      packOnSomewhere: async () => true,
      trackerKeys: async () => ({ jira: 't0k', jiraEmail: 'a@b.com' }),
      fetchImpl,
      timeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const checks = await pending;

    expect(checks[0]!.status).toBe('warn');
    expect(checks[0]!.message).toMatch(/^Atlassian MCP endpoint unreachable/);
    expect(JSON.stringify(checks[0])).not.toContain('t0k');
  });
});
