import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GetSetUpCard } from '../GetSetUpCard';
import { useUiMode } from '../../../lib/simple/uiMode';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const DISMISS_KEY = 'overdeck:get-set-up-dismissed';

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'linux',
    allRequiredFound: true,
    checks: [
      { id: 'gh', name: 'GitHub CLI', required: false, purpose: 'p', found: true, version: '2.0', install: { linux: 'sudo apt install gh', mac: 'brew install gh', win: 'winget install GitHub.cli' } },
      { id: 'herdr', name: 'Herdr', required: true, purpose: 'p', found: true, version: '1.0', install: { linux: 'pan install', mac: 'pan install', win: 'pan install' } },
      { id: 'tmux', name: 'tmux', required: false, purpose: 'p', found: true, version: '3.3', install: { linux: 'sudo apt install tmux', mac: 'brew install tmux', win: 'wsl' } },
      { id: 'docker', name: 'Docker', required: false, purpose: 'p', found: false, version: null, install: { linux: 'https://docs.docker.com', mac: 'Install Docker Desktop', win: 'Install Docker Desktop' } },
      { id: 'git', name: 'git', required: true, purpose: 'p', found: true, version: '2.40', install: { linux: '', mac: '', win: '' } },
    ],
    auth: {
      claude: { ok: true, detail: 'Signed in (max)' },
      gh: { installed: true, ok: true },
    },
    backend: { name: 'herdr', available: true, reason: null },
    memory: { availableGb: 8, warnGb: 4, low: false },
    ...overrides,
  };
}

function renderCard(report: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => report });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GetSetUpCard />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('GetSetUpCard', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useUiMode.setState({ mode: 'advanced' });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('renders the "Connect GitHub" to-do in Simple mode and shows gh auth login on Set up', async () => {
    useUiMode.setState({ mode: 'simple' });
    renderCard(baseReport({ auth: { claude: { ok: true, detail: 'Signed in' }, gh: { installed: true, ok: false } } }));

    expect(await screen.findByText('Connect GitHub')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]!);
    expect(screen.getByText('gh auth login')).toBeInTheDocument();
  });

  it('calls fetch with refresh=1 when Re-check is clicked', async () => {
    const fetchMock = renderCard(baseReport());
    await screen.findByText('Get set up');

    fireEvent.click(screen.getByRole('button', { name: /Re-check/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/prerequisites?refresh=1'));
  });

  it('renders nothing when dismissed and every required row passes', async () => {
    localStorage.setItem(DISMISS_KEY, '1');
    renderCard(baseReport());

    await waitFor(() => expect(screen.queryByText('Get set up')).not.toBeInTheDocument());
  });

  it('renders even when dismissed if Claude is not signed in', async () => {
    localStorage.setItem(DISMISS_KEY, '1');
    renderCard(baseReport({ auth: { claude: { ok: false, detail: 'Not signed in' }, gh: { installed: true, ok: true } } }));

    expect(await screen.findByText('Get set up')).toBeInTheDocument();
  });

  it('shows the low-memory sentence when memory is low', async () => {
    renderCard(baseReport({ memory: { availableGb: 3, warnGb: 4, low: true } }));
    expect(await screen.findByText('Free memory: 3 GB')).toBeInTheDocument();
    expect(screen.getByText('New agents may wait for memory to free up.')).toBeInTheDocument();
  });

  it('hides the memory row when memory is null', async () => {
    renderCard(baseReport({ memory: null }));
    await screen.findByText('Get set up');
    expect(screen.queryByText(/Free memory/)).not.toBeInTheDocument();
  });
});
