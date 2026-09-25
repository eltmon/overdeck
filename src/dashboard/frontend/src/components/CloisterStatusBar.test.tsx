import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloisterStatusBar } from './CloisterStatusBar';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    warning: (m: string) => toastWarning(m),
  },
}));

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

function mockFetch({ ttsEnabled, health, emergencyStop }: {
  ttsEnabled: boolean;
  health?: Response | Error;
  emergencyStop?: Response | Error;
}) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === '/api/cloister/emergency-stop') {
      if (emergencyStop instanceof Error) throw emergencyStop;
      return emergencyStop ?? new Response(JSON.stringify({ killedAgents: ['agent-pan-1', 'agent-pan-2'] }), { status: 200 });
    }
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

  it('uses the shared restart popover and returns focus after Escape', async () => {
    mockFetch({ ttsEnabled: false });
    renderStatusBar();

    const trigger = await screen.findByTitle('Restart sessions');
    fireEvent.click(trigger);

    const popover = screen.getByRole('dialog', { name: 'Restart sessions' });
    expect(popover).toHaveClass('bg-popover', 'shadow-floating', 'border-border');
    expect(screen.getByRole('checkbox', { name: /Conversations/i })).toHaveFocus();

    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Restart sessions' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('CloisterStatusBar emergency stop', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    toastWarning.mockClear();
  });

  async function fireStop() {
    fireEvent.click(await screen.findByTitle(/Emergency stop — kill all agents/));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  }

  it('toasts the kill count and closes the confirm when every agent is confirmed stopped', async () => {
    mockFetch({ ttsEnabled: false });
    renderStatusBar();

    await fireStop();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('killed 2 agents')));
    expect(global.fetch).toHaveBeenCalledWith('/api/cloister/emergency-stop', { method: 'POST' });
    expect(toastWarning).not.toHaveBeenCalled();
    expect(screen.queryByText('Kill all?')).not.toBeInTheDocument();
  });

  it('#4109: warns, naming the agents it could not confirm stopped', async () => {
    mockFetch({
      ttsEnabled: false,
      emergencyStop: new Response(
        JSON.stringify({ killedAgents: ['agent-pan-1'], unconfirmedAgents: ['agent-pan-2', 'agent-pan-3'] }),
        { status: 200 },
      ),
    });
    renderStatusBar();

    await fireStop();

    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('stopped 1; 2 could not be confirmed stopped: agent-pan-2, agent-pan-3'),
    ));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('toasts an error and keeps the confirm open when the request fails', async () => {
    mockFetch({ ttsEnabled: false, emergencyStop: new Response('boom', { status: 500 }) });
    renderStatusBar();

    await fireStop();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Emergency stop request failed'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(screen.getByText('Kill all?')).toBeInTheDocument();
  });
});
