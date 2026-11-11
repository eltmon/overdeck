import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadConfigNoMigration } = vi.hoisted(() => ({ mockLoadConfigNoMigration: vi.fn() }));

vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigNoMigration: mockLoadConfigNoMigration,
}));

import { isCloudJiraSite, jiraCredentialFix, resolveJiraCredentials } from '../../../../src/lib/tracker/jira-config.js';

// Built at runtime so push protection never sees a token-shaped literal (NFR-3).
const fakeToken = ['fake', 'jira', 'token'].join('-');

function withTrackerKeys(trackerKeys: Record<string, string | undefined>): void {
  mockLoadConfigNoMigration.mockResolvedValue({ config: { trackerKeys } });
}

beforeEach(() => {
  mockLoadConfigNoMigration.mockReset();
});

describe('resolveJiraCredentials', () => {
  it('prefers the project jira.site over the Settings site URL', async () => {
    withTrackerKeys({ jira: fakeToken, jiraEmail: 'dev@example.com', jiraBaseUrl: 'https://global.atlassian.net' });
    await expect(resolveJiraCredentials({ jira: { site: 'https://acme.atlassian.net' } })).resolves.toEqual({
      token: fakeToken,
      email: 'dev@example.com',
      site: 'https://acme.atlassian.net',
    });
  });

  it('falls back to the Settings site URL when the project has no site', async () => {
    withTrackerKeys({ jira: fakeToken, jiraEmail: 'dev@example.com', jiraBaseUrl: 'https://global.atlassian.net' });
    await expect(resolveJiraCredentials({})).resolves.toMatchObject({ site: 'https://global.atlassian.net' });
  });

  it('returns null with no token', async () => {
    withTrackerKeys({ jiraEmail: 'dev@example.com', jiraBaseUrl: 'https://acme.atlassian.net' });
    await expect(resolveJiraCredentials({})).resolves.toBeNull();
  });

  it('returns null with no site', async () => {
    withTrackerKeys({ jira: fakeToken, jiraEmail: 'dev@example.com' });
    await expect(resolveJiraCredentials({})).resolves.toBeNull();
  });

  it('returns null for an .atlassian.net site with no email', async () => {
    withTrackerKeys({ jira: fakeToken });
    await expect(resolveJiraCredentials({ jira: { site: 'https://acme.atlassian.net' } })).resolves.toBeNull();
  });

  it('accepts a Data Center site with no email', async () => {
    withTrackerKeys({ jira: fakeToken });
    await expect(resolveJiraCredentials({ jira: { site: 'https://jira.example.com' } })).resolves.toEqual({
      token: fakeToken,
      site: 'https://jira.example.com',
    });
  });
});

describe('isCloudJiraSite', () => {
  it('recognises atlassian.net hosts only', () => {
    expect(isCloudJiraSite('https://acme.atlassian.net')).toBe(true);
    expect(isCloudJiraSite('https://jira.example.com')).toBe(false);
    expect(isCloudJiraSite('not a url')).toBe(false);
  });
});

describe('jiraCredentialFix', () => {
  it('names the env vars and the Settings rows', () => {
    expect(jiraCredentialFix()).toContain('JIRA_API_TOKEN');
    expect(jiraCredentialFix()).toContain('Settings');
  });
});
