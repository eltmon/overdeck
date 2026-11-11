import { describe, expect, it, vi } from 'vitest';

import { checkJiraCredentials } from '../../../src/cli/commands/doctor-jira.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

const jiraProject = (site: string) => ({ key: 'acme', config: { jira: { site, deployment: 'datacenter' as const } } });
const credentials = (site: string) => async () => ({ token: fakeToken, site });

describe('checkJiraCredentials (PAN-5152)', () => {
  it('reports a 401 as an error whose fix names JIRA_API_TOKEN and Settings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const rows = await checkJiraCredentials({
      listJiraProjects: async () => [jiraProject('https://jira.example.com')],
      resolveCredentials: credentials('https://jira.example.com'),
      fetchImpl,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Jira (https://jira.example.com)', status: 'error', message: 'Jira rejected the credentials (HTTP 401)' });
    expect(rows[0].fix).toContain('JIRA_API_TOKEN');
    expect(rows[0].fix).toContain('Settings');
    expect(JSON.stringify(rows)).not.toContain(fakeToken);
  });

  it('reports an ok row with the display name on success', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ displayName: 'Ada Lovelace' })));
    const rows = await checkJiraCredentials({
      listJiraProjects: async () => [jiraProject('https://jira.example.com')],
      resolveCredentials: credentials('https://jira.example.com'),
      fetchImpl,
    });

    expect(rows).toEqual([{ name: 'Jira (https://jira.example.com)', status: 'ok', message: 'Authenticated as Ada Lovelace' }]);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://jira.example.com/rest/api/2/myself');
  });

  it('checks each distinct site once', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ displayName: 'Ada' })));
    const rows = await checkJiraCredentials({
      listJiraProjects: async () => [jiraProject('https://jira.example.com'), { ...jiraProject('https://jira.example.com'), key: 'beta' }],
      resolveCredentials: credentials('https://jira.example.com'),
      fetchImpl,
    });

    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports missing credentials with the fix and no request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const rows = await checkJiraCredentials({
      listJiraProjects: async () => [jiraProject('https://acme.atlassian.net')],
      resolveCredentials: async () => null,
      fetchImpl,
    });

    expect(rows[0]).toMatchObject({ status: 'error', message: expect.stringContaining('No Jira API token configured') });
    expect(rows[0].fix).toContain('JIRA_API_TOKEN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('warns when the site cannot be reached', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const rows = await checkJiraCredentials({
      listJiraProjects: async () => [jiraProject('https://jira.example.com')],
      resolveCredentials: credentials('https://jira.example.com'),
      fetchImpl,
    });

    expect(rows[0]).toMatchObject({ status: 'warn', fix: 'Check JIRA_BASE_URL or the project jira.site value.' });
    expect(rows[0].message).toMatch(/^Jira site unreachable: /);
  });

  it('returns no rows and makes no request without a Jira project', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolveCredentials = vi.fn();
    await expect(checkJiraCredentials({ listJiraProjects: async () => [], resolveCredentials, fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveCredentials).not.toHaveBeenCalled();
  });
});
