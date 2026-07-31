/**
 * Multi-project merge-train view tests (PAN-1696 fe-merge-train-view).
 *
 * The decoupling claim is asserted structurally: no test mocks any flywheel
 * run/state endpoint, and one test asserts the view never requests the legacy
 * per-repo endpoints or any flywheel run state, so a reintroduced dependency
 * on an active run fails here rather than silently in production.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MergeTrainView,
  MERGE_TRAIN_PROJECT_FILTER_KEY,
  mergeTrainSections,
} from '../MergeTrainView';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
}));

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

type FetchResponses = Record<string, unknown>;

/** Keys are `'<METHOD> <url-substring>'`, or a bare url substring for GET. */
function mockFetch(responses: FetchResponses): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
    }
    const method = init?.method ?? 'GET';
    const key = Object.keys(responses).find(
      (k) => url.includes(k.split(' ').pop()!) && (k.includes(' ') ? k.startsWith(method) : method === 'GET'),
    );
    if (!key) return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => responses[key] } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const PAN_QUEUE = [
  { issueId: 'PAN-1', title: 'Loading-wedge fix', branchName: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, conflictsWith: [] },
  { issueId: 'PAN-2', title: 'Transcript paths', branchName: 'feature/pan-2', mergeOrder: 2, conflictsWith: ['PAN-1'] },
];

const MIN_QUEUE = [
  { issueId: 'MIN-831', title: 'Compass briefing', branchName: 'feature/min-831', pr: 42, prUrl: 'https://y/pull/42', mergeOrder: 1, conflictsWith: [] },
];

const PAN_READY_GEN = {
  name: 'uat/pan-otter-0610',
  status: 'ready',
  baseSha: 'abc',
  createdAt: '2026-06-10T02:00:00.000Z',
  updatedAt: '',
  members: [
    { issueId: 'PAN-1', title: 'Loading-wedge fix', branch: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, acceptanceCriteria: [{ title: 'Inspector opens in <1s', status: 'pending' }] },
    { issueId: 'PAN-2', title: 'Transcript paths', branch: 'feature/pan-2', mergeOrder: 2, acceptanceCriteria: [] },
  ],
  heldOut: [],
  resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['src/x.ts'], commitSha: 'r1' }],
  stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' },
};

const MIN_READY_GEN = {
  ...PAN_READY_GEN,
  name: 'uat/min-badger-0726',
  members: [{ issueId: 'MIN-831', title: 'Compass briefing', branch: 'feature/min-831', mergeOrder: 1, acceptanceCriteria: [] }],
  resolutions: [],
  stack: { status: 'running', frontendUrl: 'https://uat-min-badger-0726.overdeck.localhost' },
};

const PAN_ASSEMBLING_GEN = {
  ...PAN_READY_GEN,
  name: 'uat/pan-copper-fox-0610',
  status: 'assembling',
  createdAt: '2026-06-10T03:00:00.000Z',
  resolutions: [],
  stack: { status: 'absent', frontendUrl: 'https://x' },
};

/** Two projects, both enabled, both with ready work. */
function twoProjectResponses(overrides: FetchResponses = {}): FetchResponses {
  return {
    '/api/merge-train/queues': [
      { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE },
      { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: MIN_QUEUE },
    ],
    '/api/merge-train/generations': [
      { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_ASSEMBLING_GEN, PAN_READY_GEN] },
      { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, generations: [MIN_READY_GEN] },
    ],
    '/api/flywheel/merge-backend': { available: true, mode: 'gh-cli', detail: 'ok' },
    ...overrides,
  };
}

function renderView(props: { showProjectFilter?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MergeTrainView active={false} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.confirm.mockClear();
  mocks.confirm.mockResolvedValue(true);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// ── AC1 ───────────────────────────────────────────────────────────────────────
describe('one section per project (ac1)', () => {
  it('renders each project with its batches, ready features, and escape hatch', async () => {
    mockFetch(twoProjectResponses());
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    const pan = screen.getByTestId('merge-train-project-overdeck');
    const myn = screen.getByTestId('merge-train-project-myn');

    expect(pan.textContent).toContain('Overdeck');
    expect(pan.textContent).toContain('merge train on');
    // Batch, its checklist, and the branch reference row all land in the section.
    expect(pan.textContent).toContain('pan-otter-0610');
    expect(pan.textContent).toContain('Inspector opens in <1s');
    expect(pan.textContent).toContain('feature/pan-1');
    expect(pan.textContent).toContain('Merge one feature to main…');
    // The assembling batch shows alongside the still-testable ready batch.
    expect(pan.textContent).toContain('pan-copper-fox-0610');
    expect(pan.textContent).toContain('assembling');

    // The MIN project is a peer section, not a footnote — the exact gap that
    // left a ready MIN-831 with no MYN generation while the run was pan-scoped.
    expect(myn.textContent).toContain('Mind Your Now');
    expect(myn.textContent).toContain('min-badger-0726');
    expect(myn.textContent).toContain('MIN-831');
    expect(myn.textContent).toContain('feature/min-831');
  });

  it('reads only the aggregate endpoints — never legacy per-repo or flywheel-run state', async () => {
    const fetchMock = mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/merge-train/queues'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/merge-train/generations'))).toBe(true);
    for (const forbidden of [
      '/api/flywheel/uat-generations',
      '/api/flywheel/merge-queue',
      '/api/flywheel/current',
      '/api/flywheel/status',
      '/api/flywheel/state',
      '/api/flywheel/runs',
    ]) {
      expect(urls.some((u) => u.includes(forbidden)), forbidden).toBe(false);
    }
  });

  it('renders live generations with no flywheel run anywhere in the data (ac4)', async () => {
    // Nothing in these payloads carries run state; the view must still show the batch.
    mockFetch({
      '/api/merge-train/queues': [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] }],
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN] },
      ],
    });
    renderView();
    await waitFor(() => expect(screen.getByText('pan-otter-0610')).toBeTruthy());
    expect(screen.getByText(/Merge batch \(2\) to main/)).toBeTruthy();
  });

  it('shows a disabled project as an explicit off row, not as "nothing ready"', async () => {
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: false, queue: [] },
      ],
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN] },
      ],
    });
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());
    const myn = screen.getByTestId('merge-train-project-myn');
    expect(myn.textContent).toContain('merge train off');
    expect(myn.textContent).toContain('turned off for Mind Your Now');
  });

  it('keeps a disabled row visible when it is MIXED with idle enabled projects', async () => {
    // The idle enabled project is hidden, but the disabled project remains because
    // its off state carries information the page-level empty copy cannot replace.
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: false, queue: [] },
      ],
      '/api/merge-train/generations': [],
    });
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-myn').textContent).toContain('turned off for Mind Your Now');
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
    expect(screen.queryByText(/No features are ready to merge in any project/)).toBeNull();
  });

  it('hides an idle enabled project when another project has ready work', async () => {
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: [] },
      ],
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN] },
      ],
    });
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.queryByTestId('merge-train-project-myn')).toBeNull();
    expect(screen.getByTestId('merge-train-idle-hidden-note').textContent).toContain(
      '1 project with nothing ready is hidden',
    );
  });

  it('pluralizes the hidden-project footer when multiple idle projects are omitted', async () => {
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: [] },
        { projectKey: 'krux', projectName: 'Krux', enabled: true, queue: [] },
      ],
      '/api/merge-train/generations': [],
    });
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByTestId('merge-train-idle-hidden-note').textContent).toContain(
      '2 projects with nothing ready are hidden',
    );
  });

  it('collapses to the page-level empty state when every project is idle and enabled', async () => {
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: [] },
      ],
      '/api/merge-train/generations': [],
    });
    renderView();

    await screen.findByText(/No features are ready to merge in any project/);
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
    expect(screen.queryByTestId('merge-train-project-myn')).toBeNull();
    expect(screen.queryByTestId('merge-train-idle-hidden-note')).toBeNull();
  });

  it('keeps the off rows visible when EVERY project has the train disabled', async () => {
    // Collapsing to "nothing ready anywhere" here would send the operator hunting
    // for missing work when the real answer is that the feature is switched off.
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: false, queue: [] },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: false, queue: [] },
      ],
      '/api/merge-train/generations': [],
    });
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
    expect(screen.queryByText(/No features are ready to merge in any project/)).toBeNull();
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('turned off for Overdeck');
  });

  it('explains an all-empty merge train without mentioning a flywheel run', async () => {
    mockFetch({
      '/api/merge-train/queues': [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] }],
      '/api/merge-train/generations': [],
    });
    renderView();
    const empty = await screen.findByText(/No features are ready to merge in any project/);
    expect(empty.textContent).not.toMatch(/flywheel/i);
  });

  it('warns when the merge backend cannot merge at all', async () => {
    mockFetch(twoProjectResponses({ '/api/flywheel/merge-backend': { available: false, mode: 'none', detail: 'no auth' } }));
    renderView();
    expect(await screen.findByText('Merge backend unavailable')).toBeTruthy();
  });

  // PAN-3165: a spec the server could not resolve must not be reported as a
  // plan that listed nothing to check — that sentence silently removed the
  // operator's UAT checklist for every issue planned after the state cutover.
  it('says the plan is unresolved instead of claiming it has no UAT steps', async () => {
    mockFetch(twoProjectResponses({
      '/api/merge-train/generations': [{
        projectKey: 'overdeck',
        projectName: 'Overdeck',
        enabled: true,
        generations: [{
          ...PAN_READY_GEN,
          members: [
            { issueId: 'PAN-3158', title: 'Cedar', branch: 'feature/pan-3158', mergeOrder: 1, acceptanceCriteria: [], planResolved: false },
          ],
          resolutions: [],
        }],
      }],
    }));
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    const pan = screen.getByTestId('merge-train-project-overdeck');
    expect(pan.textContent).toContain('Plan not found for PAN-3158');
    expect(pan.textContent).not.toContain('No UAT steps in plan');
  });

  it('keeps the no-steps message for a resolved plan that authored none', async () => {
    mockFetch(twoProjectResponses({
      '/api/merge-train/generations': [{
        projectKey: 'overdeck',
        projectName: 'Overdeck',
        enabled: true,
        generations: [{
          ...PAN_READY_GEN,
          members: [
            { issueId: 'PAN-3158', title: 'Cedar', branch: 'feature/pan-3158', mergeOrder: 1, acceptanceCriteria: [], planResolved: true },
          ],
          resolutions: [],
        }],
      }],
    }));
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    const pan = screen.getByTestId('merge-train-project-overdeck');
    expect(pan.textContent).toContain('No UAT steps in plan');
    expect(pan.textContent).not.toContain('Plan not found');
  });
});

// ── AC2 ───────────────────────────────────────────────────────────────────────
describe('project filter chips (ac2)', () => {
  it('hides deselected projects and persists the selection to localStorage', async () => {
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Mind Your Now' }));

    await waitFor(() => expect(screen.queryByTestId('merge-train-project-myn')).toBeNull());
    expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)!)).toEqual(['overdeck']);
  });

  it('restores a stored selection on mount so it survives reload', async () => {
    window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(['myn']));
    mockFetch(twoProjectResponses());
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
  });

  it('scopes the empty message to selected projects when filtered-out work is ready', async () => {
    window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(['myn']));
    mockFetch({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE },
        { projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, queue: [] },
      ],
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN] },
      ],
    });
    renderView();

    await screen.findByText(/No features are ready to merge in the selected projects/);
    expect(screen.queryByText(/No features are ready to merge in any project/)).toBeNull();
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
    expect(screen.queryByTestId('merge-train-project-myn')).toBeNull();
  });

  it('shows every project by default when nothing is stored', async () => {
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
    expect(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)).toBeNull();
  });

  it('"show all" clears the stored filter', async () => {
    window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(['myn']));
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'show all' }));

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)).toBeNull();
  });

  it('drops a stale stored project so the view cannot stay permanently empty', async () => {
    window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(['deleted-project']));
    mockFetch(twoProjectResponses());
    renderView();

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
    expect(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)).toBeNull();
  });

  it('omits the chips when the host asks for a single-project render', async () => {
    mockFetch(twoProjectResponses());
    renderView({ showProjectFilter: false });
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.queryByTestId('merge-train-project-filter')).toBeNull();
  });
});

// ── AC3 ───────────────────────────────────────────────────────────────────────
describe('actions post to the new endpoints behind confirms (ac3)', () => {
  it('promote confirms with the exact members and POSTs the aggregate promote route', async () => {
    const fetchMock = mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getAllByText(/Merge batch \(2\) to main/)[0]!);

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(arg.title).toContain('pan-otter-0610');
    expect(arg.message).toContain('PAN-1');
    expect(arg.message).toContain('PAN-2');

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u) === '/api/merge-train/generations/pan-otter-0610/promote' && (i as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('asks for a configured ship version and submits it with promote', async () => {
    const configured = { ...PAN_READY_GEN, versionSyncConfigured: true, shipStatus: null };
    const fetchMock = mockFetch(twoProjectResponses({
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [configured] },
      ],
      'POST /api/merge-train/generations/pan-otter-0610/promote': { mergeSha: 'merged', members: ['PAN-1', 'PAN-2'] },
    }));
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getByText(/Merge batch \(2\) to main/));
    const input = await screen.findByLabelText('Version for pan-otter-0610');
    fireEvent.change(input, { target: { value: '48.8.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to merge' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]![0] as { message: string };
    expect(arg.message).toContain('Version 48.8.0 will be propagated');
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/pan-otter-0610/promote'));
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ shipVersion: '48.8.0' });
    });
  });

  it('allows an empty promote version and states the ship-row consequence', async () => {
    const configured = { ...PAN_READY_GEN, versionSyncConfigured: true, shipStatus: null };
    const fetchMock = mockFetch(twoProjectResponses({
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [configured] },
      ],
      'POST /api/merge-train/generations/pan-otter-0610/promote': { mergeSha: 'merged', members: ['PAN-1', 'PAN-2'] },
    }));
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getByText(/Merge batch \(2\) to main/));
    expect(await screen.findByText(/No version supplied — the batch merges without a version bump/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to merge' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect((mocks.confirm.mock.calls[0]![0] as { message: string }).message).toContain(
      "each member's ship row will fail until you ship one",
    );
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/pan-otter-0610/promote'));
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({});
    });
  });

  it('rejects a malformed promote version before confirmation or POST', async () => {
    const configured = { ...PAN_READY_GEN, versionSyncConfigured: true, shipStatus: null };
    const fetchMock = mockFetch(twoProjectResponses({
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [configured] },
      ],
    }));
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getByText(/Merge batch \(2\) to main/));
    fireEvent.change(await screen.findByLabelText('Version for pan-otter-0610'), { target: { value: '48.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to merge' }));

    expect(await screen.findByText('version must look like 48.8.0')).toBeTruthy();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/promote'))).toBe(false);
  });

  it('shows deferred Ship version for a promoted pending batch and refreshes after POST', async () => {
    const promoted = {
      ...PAN_READY_GEN,
      status: 'promoted',
      versionSyncConfigured: true,
      shipStatus: {
        status: 'pending',
        batch: PAN_READY_GEN.name,
        reason: 'no version supplied at promote time',
        at: '2026-06-10T04:00:00.000Z',
      },
    };
    const fetchMock = mockFetch(twoProjectResponses({
      '/api/merge-train/queues': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] },
      ],
      '/api/merge-train/generations': [
        { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [promoted] },
      ],
      'POST /api/merge-train/generations/pan-otter-0610/ship': { status: 'passed' },
    }));
    renderView();

    const section = await screen.findByTestId('merge-train-project-overdeck');
    expect(section.textContent).toContain('1 promoted batch awaits version ship');
    expect(section.textContent).toContain('This batch is already on main');
    fireEvent.click(screen.getByRole('button', { name: 'Ship version' }));
    fireEvent.change(await screen.findByLabelText('Version for pan-otter-0610'), { target: { value: '48.8.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to ship' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/pan-otter-0610/ship'));
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ version: '48.8.0' });
    });
    await waitFor(() => {
      const generationReads = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/merge-train/generations'));
      expect(generationReads.length).toBeGreaterThan(1);
    });
  });

  it.each(['partial', 'failed'] as const)(
    'keeps a promoted %s batch visible with its retry action',
    async (status) => {
      const promoted = {
        ...PAN_READY_GEN,
        status: 'promoted',
        versionSyncConfigured: true,
        shipStatus: {
          status,
          version: '48.8.0',
          batch: PAN_READY_GEN.name,
          at: '2026-06-10T04:00:00.000Z',
          ...(status === 'partial'
            ? { paths: [{ path: 'package.json', ok: false, detail: 'pattern missed' }] }
            : { errorCode: 'push-failed' }),
        },
      };
      mockFetch(twoProjectResponses({
        '/api/merge-train/queues': [
          { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] },
        ],
        '/api/merge-train/generations': [
          { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [promoted] },
        ],
      }));
      renderView();

      const section = await screen.findByTestId('merge-train-project-overdeck');
      expect(section.textContent).toContain(`promoted · version ${status}`);
      expect(screen.getByRole('button', { name: 'Ship version' })).toBeInTheDocument();
    },
  );

  it('adds no version UI when the project has no version_sync', async () => {
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getAllByText(/Merge batch \(2\) to main/)[0]!);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(screen.queryByLabelText('Version for pan-otter-0610')).toBeNull();
    expect(screen.queryByText('Ship version')).toBeNull();
  });

  it('cancelling promote fires no request', async () => {
    mocks.confirm.mockResolvedValue(false);
    const fetchMock = mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(screen.getAllByText(/Merge batch \(2\) to main/)[0]!);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/promote'))).toBe(false);
  });

  it('the escape hatch names the project queue head and merges that project only', async () => {
    const fetchMock = mockFetch(
      twoProjectResponses({ 'POST /api/merge-train/merge-next': { projectKey: 'myn', outcomes: [{ issueId: 'MIN-831', result: 'merged' }] } }),
    );
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());

    // The MYN section's own escape hatch, not the PAN one.
    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-myn').querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Merge one feature to main'))!,
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]![0] as { title: string; message: string; variant?: string };
    expect(arg.title).toContain('MIN-831');
    expect(arg.message).toContain('Mind Your Now');
    expect(arg.message).toContain('bypasses batch testing');
    expect(arg.variant).toBe('destructive');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/merge-train/merge-next');
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ n: 1, project: 'myn' });
    });
  });

  it('rebuild confirms, naming the project and the discarded batch (ac3)', async () => {
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-overdeck').querySelectorAll('button'))
        .find((b) => b.textContent === '↻')!,
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(arg.title).toContain('pan-otter-0610');
    expect(arg.message).toContain('Overdeck');
    // The dialog must name the members it is about to throw away, like promote does.
    expect(arg.message).toContain('PAN-1');
    expect(arg.message).toContain('PAN-2');
    expect(arg.message).toContain('feature/pan-1');
    expect(arg.message).toMatch(/conflict resolution/);
    expect(arg.message).toMatch(/no longer applies/);
  });

  it('cancelling rebuild fires no request', async () => {
    mocks.confirm.mockResolvedValue(false);
    const fetchMock = mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-overdeck').querySelectorAll('button'))
        .find((b) => b.textContent === '↻')!,
    );
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/assemble'))).toBe(false);
  });

  it('stack confirms, warning that starting one may evict the oldest', async () => {
    mockFetch(twoProjectResponses());
    vi.stubGlobal('open', vi.fn());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-overdeck').querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Start & open'))!,
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(arg.title).toContain('pan-otter-0610');
    expect(arg.message).toMatch(/two UAT stacks run at once/);
  });

  it('rebuild POSTs assemble scoped to that project', async () => {
    const fetchMock = mockFetch(
      twoProjectResponses({ 'POST /api/merge-train/assemble': { projects: [{ projectKey: 'overdeck', result: { action: 'assembled' } }] } }),
    );
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-overdeck').querySelectorAll('button'))
        .find((b) => b.textContent === '↻')!,
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/merge-train/assemble');
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ project: 'overdeck' });
    });
  });

  it('a running stack links out instead of offering to start one', async () => {
    mockFetch(twoProjectResponses());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy());

    const link = screen.getByTestId('merge-train-project-myn').querySelector('a[href*="uat-min-badger-0726"]');
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain('Open');
  });

  // PAN-3166: the min-quartz-0726 failure — the api container had exited at
  // Flyway startup, yet the panel still offered "Open UAT frontend" in success
  // green, which is a link straight into a gateway timeout.
  it('a degraded stack offers a restart control, not an open link, and shows why', async () => {
    mockFetch(
      twoProjectResponses({
        '/api/merge-train/generations': [
          { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN] },
          {
            projectKey: 'myn',
            projectName: 'Mind Your Now',
            enabled: true,
            generations: [{
              ...MIN_READY_GEN,
              stack: {
                status: 'degraded',
                frontendUrl: 'https://uat-min-badger-0726.overdeck.localhost',
                downServices: ['api'],
                serviceErrors: {
                  api: 'Caused by: org.flywaydb.core.api.FlywayException: Found more than one migration with version 256',
                },
              },
            }],
          },
        ],
      }),
    );
    renderView();
    const panel = await screen.findByTestId('merge-train-project-myn');

    expect(panel.querySelector('a[href*="uat-min-badger-0726"]')).toBeNull();
    const control = screen.getByTestId('uat-stack-degraded-uat/min-badger-0726');
    expect(control.tagName).toBe('BUTTON');
    expect(control.textContent).toContain('Stack degraded');
    expect(control.textContent).toContain('api');
    expect(screen.getByTestId('uat-stack-degraded-detail-uat/min-badger-0726').textContent).toContain(
      'Found more than one migration with version 256',
    );
  });

  it('stack POSTs the aggregate stack route for a batch with no live stack', async () => {
    const fetchMock = mockFetch(
      twoProjectResponses({ 'POST /api/merge-train/generations': { frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost', evicted: [] } }),
    );
    vi.stubGlobal('open', vi.fn());
    renderView();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    fireEvent.click(
      Array.from(screen.getByTestId('merge-train-project-overdeck').querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Start & open'))!,
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u) === '/api/merge-train/generations/pan-otter-0610/stack' && (i as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});

// ── Pure join ─────────────────────────────────────────────────────────────────
describe('mergeTrainSections', () => {
  it('joins queues and generations on projectKey', () => {
    const sections = mergeTrainSections(
      [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: PAN_QUEUE }],
      [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [PAN_READY_GEN as never] }],
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.queue).toHaveLength(2);
    expect(sections[0]!.generations).toHaveLength(1);
  });

  it('keeps a project that has generations but no queues row', () => {
    const sections = mergeTrainSections(
      [],
      [{ projectKey: 'myn', projectName: 'Mind Your Now', enabled: true, generations: [MIN_READY_GEN as never] }],
    );
    expect(sections.map((s) => s.projectKey)).toEqual(['myn']);
    expect(sections[0]!.queue).toEqual([]);
  });

  it('tolerates a non-array queue or generations field', () => {
    const sections = mergeTrainSections(
      [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: null as never }],
      [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: undefined as never }],
    );
    expect(sections[0]!.queue).toEqual([]);
    expect(sections[0]!.generations).toEqual([]);
  });
});
