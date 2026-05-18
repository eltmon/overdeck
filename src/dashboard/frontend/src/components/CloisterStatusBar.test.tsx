import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloisterStatusBar } from './CloisterStatusBar';

const CLOISTER_STATUS = {
  running: true,
  lastCheck: '2026-05-16T00:00:00.000Z',
  summary: { active: 0, stale: 0, warning: 0, stuck: 0, total: 0 },
  agentsNeedingAttention: [],
};

function renderStatusBar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CloisterStatusBar />
    </QueryClientProvider>,
  );
}

function mockFetch({ ttsEnabled, health }: {
  ttsEnabled: boolean;
  health?: Response | Error;
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === '/api/cloister/status') {
      return new Response(JSON.stringify(CLOISTER_STATUS), { status: 200 });
    }
    if (url === '/api/specialists') {
      return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    }
    if (url === '/api/conversations') {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url === '/api/settings') {
      return new Response(JSON.stringify({ tts: { enabled: ttsEnabled } }), { status: 200 });
    }
    if (url === '/api/tts/health') {
      if (health instanceof Error) throw health;
      return health ?? new Response(JSON.stringify({ ok: true, queue: 1, model: 'qwen3-tts' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CloisterStatusBar TTS health badge', () => {
  it('shows a green TTS badge when TTS is enabled and the daemon is healthy', async () => {
    mockFetch({ ttsEnabled: true });
    renderStatusBar();

    const badge = await screen.findByTestId('tts-health-badge');
    expect(badge).toHaveTextContent('TTS');
    await waitFor(() => expect(badge).toHaveAttribute('title', 'TTS: Running (model: qwen3-tts, queue: 1)'));
    expect(screen.getByTestId('tts-health-dot')).toHaveClass('bg-success');
  });

  it('shows a gray TTS badge when the daemon reports offline', async () => {
    mockFetch({
      ttsEnabled: true,
      health: new Response(JSON.stringify({ ok: false, error: 'daemon unreachable' }), { status: 200 }),
    });
    renderStatusBar();

    const badge = await screen.findByTestId('tts-health-badge');
    await waitFor(() => expect(badge).toHaveAttribute('title', 'TTS: daemon unreachable'));
    expect(screen.getByTestId('tts-health-dot')).toHaveClass('bg-muted-foreground');
  });

  it('shows a red TTS badge when the health fetch fails', async () => {
    mockFetch({ ttsEnabled: true, health: new Error('network down') });
    renderStatusBar();

    await waitFor(() => expect(screen.getByTestId('tts-health-dot')).toHaveClass('bg-destructive'));
    expect(screen.getByTestId('tts-health-badge')).toHaveAttribute('title', 'TTS: Health check failed');
  });

  it('hides the TTS badge when TTS is disabled', async () => {
    mockFetch({ ttsEnabled: false });
    renderStatusBar();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/settings'));
    expect(screen.queryByTestId('tts-health-badge')).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith('/api/tts/health');
  });
});
