import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIssueSkillOverrideCount } from './useIssueSkillOverrideCount';

function Probe({ issueId }: { issueId: string }) {
  const count = useIssueSkillOverrideCount(issueId);
  return <div data-testid="count">{count === null ? 'null' : String(count)}</div>;
}

function renderProbe(queryClient: QueryClient, issueId = 'PAN-1') {
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe issueId={issueId} />
    </QueryClientProvider>,
  );
}

function skills(issue: string, list: Array<{ core: boolean; issue: boolean | null }>) {
  return { project: null, issue, skills: list };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIssueSkillOverrideCount', () => {
  it('returns null when the cache has no data and issues no request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderProbe(new QueryClient());
    expect(screen.getByTestId('count')).toHaveTextContent('null');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts non-core issue-level overrides from cached data', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['skill-overrides', 'issue', null, 'PAN-1'], skills('PAN-1', [
      { core: false, issue: false },
      { core: false, issue: null },
      { core: true, issue: true },
      { core: false, issue: true },
    ]));
    renderProbe(queryClient);
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('updates when the cached data changes', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['skill-overrides', 'issue', null, 'PAN-1'], skills('PAN-1', [{ core: false, issue: true }]));
    renderProbe(queryClient);
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    act(() => {
      queryClient.setQueryData(['skill-overrides', 'issue', null, 'PAN-1'], skills('PAN-1', [
        { core: false, issue: true },
        { core: false, issue: false },
        { core: false, issue: true },
      ]));
    });
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });

  it('is scoped to the issue id', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['skill-overrides', 'issue', null, 'PAN-2'], skills('PAN-2', [{ core: false, issue: true }]));
    renderProbe(queryClient, 'PAN-1');
    expect(screen.getByTestId('count')).toHaveTextContent('null');
  });
});
