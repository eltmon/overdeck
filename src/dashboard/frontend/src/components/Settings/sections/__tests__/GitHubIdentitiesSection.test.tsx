/** PAN-5153 W11: the read-only GitHub Identities section of Settings. */
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitHubIdentitiesSection } from '../GitHubIdentitiesSection';
import { SETTINGS_NAV_ITEMS } from '../../settingsPageConstants';
import type { GitHubIdentitiesSnapshot } from '../../../CommandDeck/ProjectTree/useGitHubIdentities';

function renderSection(snapshot: GitHubIdentitiesSnapshot) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GitHubIdentitiesSection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GitHubIdentitiesSection (PAN-5153)', () => {
  it('names the gh account and the App', async () => {
    renderSection({ ghLogin: 'eltmon', appSlug: 'overdeck-agent', owners: [] });
    expect(await screen.findByText(/gh account:/)).toHaveTextContent('gh account: eltmon');
    expect(screen.getByText(/GitHub App:/)).toHaveTextContent('GitHub App: overdeck-agent');
  });

  it('says when gh is not signed in and no App is configured', async () => {
    renderSection({ ghLogin: null, appSlug: null, owners: [] });
    expect(await screen.findByText(/gh account:/)).toHaveTextContent('gh account: not signed in');
    expect(screen.getByText(/GitHub App:/)).toHaveTextContent('GitHub App: not configured');
  });

  it('shows one row per project with its actor and the owner on the first row only', async () => {
    renderSection({
      ghLogin: 'eltmon',
      appSlug: 'overdeck-agent',
      owners: [{
        owner: 'acme',
        projects: [
          { key: 'web', name: 'Web', repo: 'acme/web', mode: 'user', actor: 'eltmon', detail: 'GitHub App is not installed on this repository' },
          { key: 'api', name: 'API', repo: 'acme/api', mode: 'app', actor: 'overdeck-agent[bot]', detail: 'GitHub App is installed on this repository' },
        ],
      }],
    });
    const web = await screen.findByTestId('github-identity-row-web');
    const api = screen.getByTestId('github-identity-row-api');
    expect(within(web).getByText('eltmon')).toBeInTheDocument();
    expect(within(api).getByText('overdeck-agent[bot]')).toBeInTheDocument();
    expect(within(web).getByText('acme')).toBeInTheDocument();
    expect(within(api).queryByText('acme')).not.toBeInTheDocument();
  });

  it('says so when no project has a GitHub repository', async () => {
    renderSection({ ghLogin: 'eltmon', appSlug: null, owners: [] });
    expect(await screen.findByText('No registered project has a GitHub repository.')).toBeInTheDocument();
  });

  it('lists GitHub Identities directly after Tracker Keys in the Settings nav', () => {
    const ids = SETTINGS_NAV_ITEMS.map((item) => item.id);
    expect(ids[ids.indexOf('tracker-keys') + 1]).toBe('github-identities');
    expect(SETTINGS_NAV_ITEMS.find((item) => item.id === 'github-identities')?.label).toBe('GitHub Identities');
  });
});
