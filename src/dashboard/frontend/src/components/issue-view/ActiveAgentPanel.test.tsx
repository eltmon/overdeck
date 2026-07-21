import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DialogProvider } from '../DialogProvider';
import { useDashboardStore } from '../../lib/store';
import { ActiveAgentPanel } from './ActiveAgentPanel';
import type { AgentSnapshot } from '@overdeck/contracts';

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' });
    if (url.includes('/api/agents/') && url.endsWith('/has-session')) {
      // The registry resumeSession path checks lifecycle resumability here.
      return Response.json({ lifecycle: { agentId: 'agent-pan-2499-slot-2', canResumeSession: true, hasSavedSession: true, hasWorkspace: true, recommendedAction: 'resume' } });
    }
    if (url.includes('/api/agents/') && (url.endsWith('/tell') || url.endsWith('/resume'))) {
      return Response.json({ messageDelivered: true });
    }
    return Response.json({ success: true });
  });
}

function makeAgent(overrides: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: overrides.id,
    issueId: overrides.issueId ?? 'PAN-2499',
    status: overrides.status ?? 'running',
    runtime: overrides.runtime ?? 'claude-code',
    model: overrides.model ?? 'claude-sonnet-5',
    role: overrides.role ?? 'work',
    ...overrides,
  } as AgentSnapshot;
}

function renderPanel(agentId = 'agent-pan-2499-slot-2', props: { density?: 'console' | 'cockpit' | 'rail' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <ActiveAgentPanel agentId={agentId} density={props.density} />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('ActiveAgentPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch());
    useDashboardStore.setState({
      agentsById: {},
      agentOutputById: {},
      channelPermissionRequestsById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders fallback when no agent is present', () => {
    renderPanel();
    expect(screen.getByTestId('active-agent-panel')).toBeInTheDocument();
    expect(screen.getByText('No active agent.')).toBeInTheDocument();
  });

  it('renders the agent header without the deleted stream excerpt', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2' }),
      },
      agentOutputById: {
        'agent-pan-2499-slot-2': ['→ starting task', '✓ done', '✗ lint failed'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    // PAN-2908 C-DETAIL: the stream-excerpt box is deleted — the conversation
    // pane is the live view. The header/meta/tell survive.
    expect(screen.getByText('agent-pan-2499-slot-2')).toBeInTheDocument();
    expect(screen.queryByTestId('active-agent-panel-stream')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent stream output')).not.toBeInTheDocument();
    expect(screen.queryByText('→ starting task')).not.toBeInTheDocument();
  });

  it('keeps errored agents visible with diagnostics and recovery controls', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', status: 'error' }),
      },
      agentOutputById: {
        'agent-pan-2499-slot-2': ['✗ worker exited'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    expect(screen.queryByText('No active agent.')).not.toBeInTheDocument();
    expect(screen.getByText(/STUCK/)).toBeInTheDocument();
    expect(await screen.findByTestId('active-agent-panel-resume')).toBeInTheDocument();
  });

  it('posts Tell input to /api/agents/:agentId/tell for a live agent', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', status: 'running' }),
      },
      agentOutputById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    fireEvent.change(screen.getByLabelText('Tell agent-pan-2499-slot-2'), {
      target: { value: 'Please continue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        '/api/agents/agent-pan-2499-slot-2/tell',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Please continue' }),
        }),
      );
    });
    expect(screen.getByLabelText('Tell agent-pan-2499-slot-2')).toHaveValue('');
  });

  it('posts Tell input to /api/agents/:agentId/resume for a stopped agent', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', status: 'stopped' }),
      },
      agentOutputById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    fireEvent.change(screen.getByLabelText('Tell agent-pan-2499-slot-2'), {
      target: { value: 'Wake up' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        '/api/agents/agent-pan-2499-slot-2/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Wake up' }),
        }),
      );
    });
  });

  it('renders a Resume button that posts to /api/agents/:agentId/resume (registry path, PAN-2975)', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', status: 'stopped' }),
      },
      agentOutputById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    const resumeButton = await screen.findByTestId('active-agent-panel-resume');
    expect(resumeButton).toHaveTextContent('Resume session · PAN-2499');
    expect(resumeButton).toHaveAttribute('title', 'Reopens the saved session with its memory intact.');
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        '/api/agents/agent-pan-2499-slot-2/resume',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('exposes inventory section attributes', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2' }),
      },
      agentOutputById: {
        'agent-pan-2499-slot-2': ['line one'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    expect(document.querySelector('[data-section="active-agent-panel"]')).toBeInTheDocument();
    expect(document.querySelector('[data-section="active-agent-panel-header"]')).toBeInTheDocument();
    expect(document.querySelector('[data-section="active-agent-panel-stream"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-section="active-agent-panel-tell"]')).toBeInTheDocument();
  });
});
