import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStrictFetchMock } from '../test-utils/strictFetchMock';
import { AwaitingMergePage, AwaitingMergeRow } from './AwaitingMergePage';

vi.mock('./DialogProvider', () => ({
  useConfirm: () => vi.fn(async () => true),
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

let queryClients: QueryClient[] = [];
let fetchControl: ReturnType<typeof installStrictFetchMock>;

beforeEach(() => {
  queryClients = [];
  fetchControl = installStrictFetchMock(({ method, url }) => {
    if (method === 'GET' && url === '/api/flywheel/config') {
      return Response.json({ auto_pickup_backlog: false, require_uat_before_merge: false });
    }
    if (method === 'GET' && url === '/api/workspaces/PAN-1686/uat-context') {
      return Response.json({
        acceptanceCriteria: [
          {
            id: 'uat.ac1',
            title: 'Fetched checklist item',
            status: 'pending',
            itemId: 'frontend-what-to-test',
            itemTitle: 'Frontend checklist',
          },
        ],
      });
    }
    return undefined;
  });
});

afterEach(async () => {
  cleanup();
  await Promise.all(queryClients.map((queryClient) => queryClient.cancelQueries()));
  queryClients.forEach((queryClient) => queryClient.clear());
  await fetchControl.assertNoUnexpectedRequests();
  vi.unstubAllGlobals();
});

function renderRow(overrides: Partial<React.ComponentProps<typeof AwaitingMergeRow>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClients.push(queryClient);

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
    const uatContextCalls = () => fetchControl.fetchMock.mock.calls.filter(([url]) => url === uatContextUrl);

    renderRow();

    expect(uatContextCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId('merge-uat-toggle-PAN-1686'));

    await waitFor(() => expect(uatContextCalls()).toHaveLength(1));
    expect(fetchControl.fetchMock).toHaveBeenCalledWith(uatContextUrl);
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
      frontendUrl: 'https://feature-pan-1686.overdeck.localhost',
      apiUrl: 'https://api-feature-pan-1686.overdeck.localhost',
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

/**
 * PAN-1696 fe-awaiting-merge: the merge gate hosts the multi-project merge
 * train above the per-issue rows, with a global enable toggle. The strict fetch
 * mock is the real assertion for ac1 — it fails on any request the page makes
 * that is not listed here, so a reintroduced flywheel-run dependency shows up
 * as an unexpected request rather than passing silently.
 */
const MERGE_TRAIN_QUEUES = [
  {
    projectKey: 'overdeck',
    projectName: 'Overdeck',
    enabled: true,
    queue: [
      { issueId: 'PAN-1', title: 'Loading-wedge fix', branchName: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, conflictsWith: [] },
    ],
  },
  { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: [] },
];

const MERGE_TRAIN_GENERATIONS = [
  {
    projectKey: 'overdeck',
    projectName: 'Overdeck',
    enabled: true,
    generations: [
      {
        name: 'uat/pan-otter-0610',
        status: 'ready',
        baseSha: 'abc',
        createdAt: '2026-06-10T02:00:00.000Z',
        updatedAt: '',
        members: [
          { issueId: 'PAN-1', title: 'Loading-wedge fix', branch: 'feature/pan-1', pr: 11, mergeOrder: 1, acceptanceCriteria: [{ title: 'Inspector opens in <1s', status: 'pending' }] },
        ],
        heldOut: [],
        resolutions: [],
        stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' },
      },
    ],
  },
];

function renderPage(config: Record<string, unknown> = { auto_pickup_backlog: false, require_uat_before_merge: false, merge_train_enabled: true }) {
  const configPosts: unknown[] = [];
  fetchControl = installStrictFetchMock(({ method, url, init }) => {
    if (method === 'GET' && url === '/api/flywheel/config') return Response.json(config);
    if (method === 'POST' && url === '/api/flywheel/config') {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      configPosts.push(patch);
      return Response.json({ ...config, ...patch });
    }
    if (method === 'GET' && url === '/api/merge-train/queues') return Response.json(MERGE_TRAIN_QUEUES);
    if (method === 'GET' && url === '/api/merge-train/generations') return Response.json(MERGE_TRAIN_GENERATIONS);
    if (method === 'GET' && url === '/api/flywheel/merge-backend') return Response.json({ available: true, mode: 'gh-cli', detail: 'ok' });
    return undefined;
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AwaitingMergePage />
    </QueryClientProvider>,
  );
  return { ...utils, configPosts };
}

describe('AwaitingMergePage merge train', () => {
  it('renders the multi-project merge-train view above the per-issue rows (ac1)', async () => {
    renderPage();

    const section = await screen.findByTestId('awaiting-merge-merge-train');
    expect(section.textContent).toContain('Merge train');
    expect(section.textContent).toContain('Assembles and batch-tests ready features per project');

    // Populated from the aggregate endpoints with no flywheel run in the data.
    // The active project renders while the idle enabled project is summarized below it.
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('pan-otter-0610');
    expect(screen.queryByTestId('merge-train-project-myn')).toBeNull();
    expect(screen.getByTestId('merge-train-idle-hidden-note').textContent).toContain(
      '1 project with nothing ready is hidden',
    );

    // Above the rows, not after them: the section precedes the merge list in DOM order.
    const view = screen.getByTestId('merge-train-view');
    expect(section.contains(view)).toBe(true);
    expect(section.compareDocumentPosition(screen.getByRole('heading', { name: 'Awaiting Merge' })))
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('reflects the current enabled state and persists a change through the config endpoint (ac2)', async () => {
    const { configPosts } = renderPage();

    const toggle = await screen.findByRole('switch', { name: 'Merge train' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(toggle.textContent).toContain('On');

    fireEvent.click(toggle);

    await waitFor(() => expect(configPosts).toEqual([{ merge_train_enabled: false }]));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Merge train' }).getAttribute('aria-checked')).toBe('false'));
  });

  it('shows the toggle off when the global flag is off (ac2)', async () => {
    renderPage({ auto_pickup_backlog: false, require_uat_before_merge: false, merge_train_enabled: false });
    const toggle = await screen.findByRole('switch', { name: 'Merge train' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(toggle.textContent).toContain('Off');
  });
});
