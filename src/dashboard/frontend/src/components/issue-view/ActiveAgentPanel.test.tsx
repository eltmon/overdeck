import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useDashboardStore } from '../../lib/store';
import { ActiveAgentPanel, classifyStreamLine } from './ActiveAgentPanel';
import type { AgentSnapshot } from '@overdeck/contracts';

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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
  return render(<ActiveAgentPanel agentId={agentId} density={props.density} />);
}

describe('classifyStreamLine', () => {
  it('classifies error glyphs and keywords as err', () => {
    expect(classifyStreamLine('✗ test failed')).toBe('err');
    expect(classifyStreamLine('something raised an ERROR')).toBe('err');
    expect(classifyStreamLine('compilation FAIL')).toBe('err');
  });

  it('classifies warning glyphs and keywords as warn', () => {
    expect(classifyStreamLine('! review changes requested')).toBe('warn');
    expect(classifyStreamLine('WARN: stale cache hit')).toBe('warn');
  });

  it('classifies success glyphs and keywords as ok', () => {
    expect(classifyStreamLine('✓ all tests pass')).toBe('ok');
    expect(classifyStreamLine('OK now ready')).toBe('ok');
    expect(classifyStreamLine('build PASS')).toBe('ok');
    expect(classifyStreamLine('compile done')).toBe('ok');
  });

  it('classifies arrow/bullet glyphs as verb-line', () => {
    expect(classifyStreamLine('→ implementing bead 4')).toBe('verb-line');
    expect(classifyStreamLine('▸ entering review phase')).toBe('verb-line');
    expect(classifyStreamLine('✱ thinking...')).toBe('verb-line');
  });

  it('falls back to neutral for unclassified lines', () => {
    expect(classifyStreamLine('Reading file foo.ts')).toBe('neutral');
    expect(classifyStreamLine('')).toBe('neutral');
  });

  it('err beats warn beats ok beats verb-line in precedence', () => {
    expect(classifyStreamLine('→ ERROR detected')).toBe('err');
    expect(classifyStreamLine('→ WARN cache stale')).toBe('warn');
    expect(classifyStreamLine('→ done')).toBe('ok');
  });
});

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

  it('renders live output lines from the store', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2' }),
      },
      agentOutputById: {
        'agent-pan-2499-slot-2': ['→ starting task', '✓ done', '✗ lint failed'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    const stream = screen.getByTestId('active-agent-panel-stream');
    expect(stream).toBeInTheDocument();
    expect(stream).toHaveClass('max-h-[180px]');
    expect(screen.getByText('→ starting task')).toHaveClass('text-signal-review-foreground');
    expect(screen.getByText('✓ done')).toHaveClass('text-success-foreground');
    expect(screen.getByText('✗ lint failed')).toHaveClass('text-destructive-foreground');
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

  it('renders a Resume button that posts to /api/agents/:agentId/resume', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2', status: 'stopped' }),
      },
      agentOutputById: {},
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel();

    const resumeButton = screen.getByTestId('active-agent-panel-resume');
    expect(resumeButton).toBeInTheDocument();
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith(
        '/api/agents/agent-pan-2499-slot-2/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Resumed from active agent panel' }),
        }),
      );
    });
  });

  it('uses compact stream height for rail density', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-2499-slot-2': makeAgent({ id: 'agent-pan-2499-slot-2' }),
      },
      agentOutputById: {
        'agent-pan-2499-slot-2': ['line one'],
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    renderPanel('agent-pan-2499-slot-2', { density: 'rail' });

    expect(screen.getByTestId('active-agent-panel-stream')).toHaveClass('max-h-[120px]');
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
    expect(document.querySelector('[data-section="active-agent-panel-stream"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-section="active-agent-panel-stream-line"]')).toHaveLength(1);
    expect(document.querySelector('[data-section="active-agent-panel-tell"]')).toBeInTheDocument();
  });
});
