import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwaitingMergeRow } from './AwaitingMergePage';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRow(overrides: Partial<React.ComponentProps<typeof AwaitingMergeRow>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AwaitingMergeRow
        issueId="PAN-1686"
        identifier="PAN-1686"
        title="Show UAT context"
        onMerged={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('AwaitingMergeRow UAT context', () => {
  it('lazy-loads UAT context only after the section expands', async () => {
    const uatContextUrl = '/api/workspaces/PAN-1686/uat-context';
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== uatContextUrl) {
        return new Response(JSON.stringify({ enabled: false }), { status: 200 });
      }

      return new Response(JSON.stringify({
        acceptanceCriteria: [
          {
            id: 'uat.ac1',
            title: 'Fetched checklist item',
            status: 'pending',
            itemId: 'frontend-what-to-test',
            itemTitle: 'Frontend checklist',
          },
        ],
      }), { status: 200 });
    });
    const uatContextCalls = () => fetchMock.mock.calls.filter(([url]) => url === uatContextUrl);
    vi.stubGlobal('fetch', fetchMock);

    renderRow();

    expect(uatContextCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));

    await waitFor(() => expect(uatContextCalls()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(uatContextUrl);
    expect(await screen.findByText('Fetched checklist item')).toBeTruthy();
  });

  it('toggles the UAT context section and renders acceptance criteria', () => {
    renderRow({
      uatContext: {
        acceptanceCriteria: [
          {
            id: 'uat.ac1',
            title: 'Verify the UAT checklist is visible',
            status: 'pending',
            itemId: 'frontend-what-to-test',
            itemTitle: 'Frontend checklist',
          },
        ],
      },
    });

    expect(screen.queryByText('Verify the UAT checklist is visible')).toBeNull();

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));

    expect(screen.getByTestId('merge-uat-context-PAN-1686')).toBeTruthy();
    expect(screen.getByText('What to test (UAT)')).toBeTruthy();
    expect(screen.getByText('Verify the UAT checklist is visible')).toBeTruthy();
    expect(screen.getByText('(Frontend checklist)')).toBeTruthy();

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));
    expect(screen.queryByText('Verify the UAT checklist is visible')).toBeNull();
  });

  it('falls back to the issue description when acceptance criteria are missing', () => {
    renderRow({
      description: 'Use the issue description as the manual UAT checklist.',
      uatContext: { acceptanceCriteria: [] },
    });

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));

    expect(screen.getByText('Use the issue description as the manual UAT checklist.')).toBeTruthy();
  });

  it('renders inline UAT stack startup state in the merge row', () => {
    renderRow({
      frontendUrl: 'https://feature-pan-1686.pan.localhost',
      apiUrl: 'https://api-feature-pan-1686.pan.localhost',
      stackHealthy: false,
      stackHealth: {
        healthy: false,
        reasons: ['api unhealthy: connection refused'],
        lastObserved: '2026-06-14T19:02:00.000Z',
      },
      containers: {
        postgres: { running: true, uptime: '2m', status: 'running', health: 'healthy', ports: [5432] },
        api: { running: true, uptime: '42s', status: 'running', health: 'starting', ports: [8080], lastFailureReason: 'connection refused' },
      },
    });

    expect(screen.getByTestId('merge-uat-stack-PAN-1686')).toBeTruthy();
    expect(screen.getByText('UAT stack 1/2 healthy')).toBeTruthy();
    expect(screen.getByText('api unhealthy: connection refused')).toBeTruthy();
    expect(screen.getByText('postgres')).toBeTruthy();
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('starting')).toBeTruthy();
  });

  it('renders expected deliverables, changed files, and omitted-file count', () => {
    renderRow({
      uatContext: {
        acceptanceCriteria: [
          {
            id: 'uat.ac1',
            title: 'Verify UAT context',
            status: 'pending',
            itemId: 'frontend-tests',
            itemTitle: 'Frontend tests',
          },
        ],
        deliverables: [
          {
            id: 'frontend-expected-changes',
            title: 'Expected changes section',
            status: 'completed',
            action: 'Render deliverables and PR changed files.',
          },
        ],
        changedFiles: [
          {
            path: 'src/dashboard/frontend/src/components/AwaitingMergePage.tsx',
            status: 'M',
            additions: 42,
            deletions: 3,
          },
        ],
        changedFilesOmitted: 2,
      },
    });

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));

    expect(screen.getByText('Expected changes')).toBeTruthy();
    expect(screen.getByText('Expected changes section')).toBeTruthy();
    expect(screen.getByText('Render deliverables and PR changed files.')).toBeTruthy();
    expect(screen.getByText('src/dashboard/frontend/src/components/AwaitingMergePage.tsx')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('+42')).toBeTruthy();
    expect(screen.getByText('-3')).toBeTruthy();
    expect(screen.getByText('+2 more files')).toBeTruthy();
  });
});
