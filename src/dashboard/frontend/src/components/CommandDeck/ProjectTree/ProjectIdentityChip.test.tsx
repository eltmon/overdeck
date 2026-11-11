/** PAN-5153 W10: the project header's identity chip. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectIdentityChip } from './ProjectIdentityChip';
import type { GitHubIdentitiesSnapshot, GitHubIdentityProject } from './useGitHubIdentities';

function snapshotWith(project: Partial<GitHubIdentityProject>): GitHubIdentitiesSnapshot {
  return {
    ghLogin: 'eltmon',
    appSlug: 'overdeck-agent',
    owners: [{
      owner: 'acme',
      projects: [{
        key: 'web',
        name: 'Web',
        repo: 'acme/web',
        mode: 'app',
        actor: 'overdeck-agent[bot]',
        detail: 'GitHub App is installed on this repository',
        ...project,
      }],
    }],
  };
}

function renderChip(snapshot: GitHubIdentitiesSnapshot, projectKey = 'web') {
  const fetchMock = vi.fn(async () => Response.json(snapshot));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectIdentityChip projectKey={projectKey} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectIdentityChip (PAN-5153)', () => {
  it('names the owner and the bot, with the detail as its title', async () => {
    renderChip(snapshotWith({}));
    const chip = await screen.findByTestId('project-identity-chip');
    expect(chip).toHaveTextContent('acme · overdeck-agent[bot]');
    expect(chip).toHaveAttribute('title', 'GitHub App is installed on this repository');
  });

  it('names the gh user on an uncovered repository', async () => {
    renderChip(snapshotWith({ mode: 'user', actor: 'eltmon', detail: 'GitHub App is not installed on this repository' }));
    expect(await screen.findByTestId('project-identity-chip')).toHaveTextContent('acme · eltmon');
  });

  it('says not signed in when nobody acts', async () => {
    renderChip(snapshotWith({ mode: 'none', actor: null, detail: 'gh is not signed in. Run: gh auth login' }));
    expect(await screen.findByTestId('project-identity-chip')).toHaveTextContent('acme · not signed in');
  });

  it('renders nothing for a project the snapshot does not list', async () => {
    const fetchMock = renderChip(snapshotWith({}), 'unknown');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/github/identities'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('project-identity-chip')).not.toBeInTheDocument();
  });
});
