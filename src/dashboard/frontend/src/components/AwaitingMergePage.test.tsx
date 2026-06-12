import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwaitingMergePage, AwaitingMergeRow } from './AwaitingMergePage';
import { DialogProvider } from './DialogProvider';
import { useDashboardStore } from '../lib/store';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

beforeEach(() => {
  localStorage.clear();
  useDashboardStore.setState({
    issuesRaw: [],
    reviewStatusByIssueId: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <AwaitingMergePage />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function seedAwaitingMergeStore() {
  useDashboardStore.setState({
    issuesRaw: [
      {
        id: 'PAN-1',
        identifier: 'PAN-1',
        title: 'Ready feature',
        status: 'In Review',
        priority: 0,
        labels: [],
        url: 'https://github.com/eltmon/panopticon-cli/issues/1',
        createdAt: '2026-06-12T10:00:00.000Z',
        updatedAt: '2026-06-12T10:00:00.000Z',
        state: 'in_review',
      },
      {
        id: 'PAN-2',
        identifier: 'PAN-2',
        title: 'Pipeline feature',
        status: 'In Review',
        priority: 0,
        labels: [],
        url: 'https://github.com/eltmon/panopticon-cli/issues/2',
        createdAt: '2026-06-12T10:00:00.000Z',
        updatedAt: '2026-06-12T10:00:00.000Z',
        state: 'in_review',
      },
    ],
    reviewStatusByIssueId: {
      'PAN-1': {
        issueId: 'PAN-1',
        readyForMerge: true,
        mergeStatus: 'pending',
        reviewStatus: 'passed',
        testStatus: 'passed',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
        updatedAt: '2026-06-12T11:00:00.000Z',
        autoMerge: false,
      },
      'PAN-2': {
        issueId: 'PAN-2',
        readyForMerge: false,
        mergeStatus: 'pending',
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'pending',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/2',
        updatedAt: '2026-06-12T11:05:00.000Z',
      },
    },
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

function mockPageFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/flywheel/config' && init?.method === 'POST') {
      return Response.json({ merge_train_enabled: true, require_uat_before_merge: true });
    }
    if (url === '/api/flywheel/config') {
      return Response.json({ merge_train_enabled: false, require_uat_before_merge: true });
    }
    if (url === '/api/merge-train/generations') {
      return Response.json([
        {
          projectKey: 'panopticon',
          projectName: 'Panopticon',
          generations: [
            {
              name: 'uat/pan-otter-0612',
              status: 'ready',
              baseSha: 'abc',
              createdAt: '2026-06-12T10:00:00.000Z',
              updatedAt: '2026-06-12T10:10:00.000Z',
              members: [
                {
                  issueId: 'PAN-1',
                  title: 'Ready feature',
                  branch: 'feature/pan-1',
                  mergeOrder: 1,
                  acceptanceCriteria: [{ title: 'Verify ready feature', status: 'pending' }],
                },
              ],
              heldOut: [],
              resolutions: [],
              stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0612.pan.localhost' },
            },
          ],
        },
      ]);
    }
    if (url === '/api/merge-train/queues') {
      return Response.json([
        {
          projectKey: 'panopticon',
          projectName: 'Panopticon',
          enabled: true,
          queue: [
            {
              issueId: 'PAN-1',
              title: 'Ready feature',
              branchName: 'feature/pan-1',
              pr: 1,
              prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
              mergeOrder: 1,
              conflictsWith: [],
            },
          ],
        },
      ]);
    }
    if (url === '/api/workspaces/PAN-1') {
      return Response.json({
        frontendUrl: 'https://feature-pan-1.pan.localhost',
        mrUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
        stackHealth: { healthy: true, reasons: [] },
      });
    }
    if (url === '/api/workspaces/PAN-1/auto-merge' && init?.method === 'POST') {
      return Response.json({ ok: true });
    }
    if (url === '/api/issues/PAN-1/merge' && init?.method === 'POST') {
      return Response.json({ ok: true });
    }
    if (url === '/api/issues/PAN-2/forge-approve' && init?.method === 'POST') {
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AwaitingMergePage', () => {
  it('renders the multi-project merge train view above per-issue rows without an active run', async () => {
    seedAwaitingMergeStore();
    mockPageFetch();

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Merge train' })).toBeTruthy();
    expect(await screen.findByText('pan-otter-0612')).toBeTruthy();
    expect(await screen.findByTestId('merge-row-PAN-1')).toBeTruthy();

    const mergeTrain = screen.getByRole('region', { name: 'Merge train' });
    const row = screen.getByTestId('merge-row-PAN-1');
    expect(mergeTrain.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('toggles merge-train enablement through the config endpoint', async () => {
    seedAwaitingMergeStore();
    const fetchMock = mockPageFetch();

    renderPage();

    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/config', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ merge_train_enabled: true }),
      }));
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('preserves merge, approve, auto-merge, and UAT row actions', async () => {
    seedAwaitingMergeStore();
    const fetchMock = mockPageFetch();

    renderPage();

    const uatLink = await screen.findByRole('link', { name: 'UAT' });
    expect(uatLink).toHaveAttribute('href', 'https://feature-pan-1.pan.localhost');

    fireEvent.click(screen.getByRole('button', { name: /Auto/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/PAN-1/auto-merge', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ autoMerge: true }),
      }));
    });

    fireEvent.click(screen.getByTestId('merge-btn-PAN-1'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-1/merge', expect.objectContaining({ method: 'POST' }));
    });

    fireEvent.click(await screen.findByText('Pipeline Override'));
    fireEvent.click(await screen.findByRole('button', { name: 'Force Approve' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Force Approve' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Force Approve' })[1]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-2/forge-approve', expect.objectContaining({ method: 'POST' }));
    });
  });
});

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
