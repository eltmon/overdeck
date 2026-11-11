import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../../DialogProvider';
import type { Issue } from '../../../types';
import { TrackerShadowBadges } from '../badges';
import { IssueCard } from './KanbanCards';

function jiraIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'jira-10001',
    identifier: 'PROJ-1',
    title: 'Add Jira support',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://acme.atlassian.net/browse/PROJ-1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    project: { id: 'jira-acme', name: 'Acme', color: '#2684FF' },
    source: 'jira',
    ...overrides,
  } as Issue;
}

let queryClient: QueryClient | undefined;

function renderCard(issue: Issue) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <IssueCard issue={issue} isSelected={false} onSelect={() => {}} />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('IssueCard for a Jira issue (PAN-5152)', () => {
  // The card's background requests (orders, settings, harness policy) are not
  // under test. Some run from effect chains that outlive the render, so stub
  // fetch for the whole file; the shared setup skips its guard while a stub is in place.
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    cleanup();
    queryClient?.clear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('labels the tracker reference as Jira', () => {
    renderCard(jiraIssue());
    expect(screen.getByText('Jira PROJ-1')).toBeTruthy();
  });

  it('prefixes the shadow-state tooltip with Jira for a Jira issue', () => {
    const { container } = render(
      <TrackerShadowBadges issue={jiraIssue({ rawTrackerState: 'In Progress', shadowStatus: 'in_review' } as Partial<Issue>)} compact />,
    );
    expect(container.querySelector('span')?.getAttribute('title')).toBe('Jira: In Progress → Pan: In Review');
  });
});
