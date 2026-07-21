import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useResumeRecovery } from '../../lib/resumeRecovery';
import { StartAgentCta } from './StartAgentCta';

const useIssueActions = vi.fn();
const refreshDashboardState = vi.fn();

vi.mock('../IssueActionMenu/useIssueActions', () => ({ useIssueActions: (...args: unknown[]) => useIssueActions(...args) }));
vi.mock('../shared/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [], defaultModel: 'claude-sonnet-5', harnessPolicy: undefined }),
  ModelHarnessPicker: () => <div>model picker</div>,
}));
vi.mock('../../lib/wsTransport', () => ({ dashboardMutationJsonHeaders: () => Promise.resolve({ 'content-type': 'application/json' }) }));
vi.mock('../../lib/refresh-dashboard-state', () => ({ refreshDashboardState: (...args: unknown[]) => refreshDashboardState(...args) }));

const action = (key: string, enabled: boolean) => ({ action: { key }, enabled, isPending: false, invoke: vi.fn() });

function setState({ start = false, resume = false, troubled = false, paused = false, agentId = 'agent-pan-2499' } = {}) {
  useIssueActions.mockReturnValue({
    all: [action('startAgent', start), action('resumeSession', resume)],
    agent: agentId ? { id: agentId, troubled, paused } : undefined,
    issue: { project: { id: 'overdeck' } },
  });
}

function renderCta(density: 'rail' | 'cockpit' | 'console' = 'cockpit') {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><StartAgentCta issueId="PAN-2499" density={density} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useResumeRecovery.setState({ request: null });
  refreshDashboardState.mockResolvedValue(undefined);
  setState();
});

describe('StartAgentCta', () => {
  it.each(['rail', 'cockpit', 'console'] as const)('renders the shared start action at %s density', (density) => {
    setState({ start: true });
    const { container } = renderCta(density);
    expect(screen.getByRole('button', { name: 'Start work agent' })).toBeInTheDocument();
    expect(container.querySelector('[data-section="StartAgentCta"]')).toBeInTheDocument();
  });

  it('does not render while an agent is running', () => {
    const { container } = renderCta();
    expect(container).toBeEmptyDOMElement();
  });

  it('starts a plain stopped issue without clearGates', async () => {
    setState({ start: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Start work agent' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/agents', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ issueId: 'PAN-2499', projectId: 'overdeck' }),
    }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['troubled'],
    ['paused'],
  ] as const)('opens the shared recovery dialog for the %s gate instead of an inline confirm', async (kind) => {
    setState({ start: true, [kind]: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Start work agent' }));
    // No inline confirm, no fetch — the click hands the gate to the same
    // ResumableSessionDialog every other start surface uses.
    expect(useResumeRecovery.getState().request).toEqual({ kind, agentId: 'agent-pan-2499', issueId: 'PAN-2499' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hands a 409 resumable-session block to the recovery dialog instead of showing CLI text', async () => {
    setState({ start: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        error: "Agent agent-pan-2499 has a resumable Claude session. Use 'pan resume agent-pan-2499' to continue it, or 'pan start agent-pan-2499 --fresh' to start a new session.",
        lifecycle: { agentId: 'agent-pan-2499', canResumeSession: true },
      }),
      { status: 409 },
    ));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Start work agent' }));
    await waitFor(() => expect(useResumeRecovery.getState().request).toEqual({ kind: 'resumable', agentId: 'agent-pan-2499', issueId: 'PAN-2499' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resumes a resumable stopped session through the agent endpoint', async () => {
    setState({ resume: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session · PAN-2499' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-2499/resume', expect.objectContaining({ method: 'POST' })));
  });

  it('identifies its issue and uses the quiet resume treatment (PAN-2975)', () => {
    setState({ resume: true });
    renderCta('rail');
    const button = screen.getByRole('button', { name: 'Resume session · PAN-2499' });
    // Compact (rail/chip/inline): badge-like chip, never a loud primary block.
    expect(button).toHaveClass('bg-info/10', 'border-info/30', 'text-info-foreground', 'text-[10px]');
    expect(button).not.toHaveClass('bg-primary');
    expect(button).toHaveAttribute('title', 'Reopens the saved session for PAN-2499 with its memory intact');
  });

  it('keeps the fuller quiet button at issue-view surfaces', () => {
    setState({ resume: true });
    renderCta('console');
    const button = screen.getByRole('button', { name: 'Resume session · PAN-2499' });
    expect(button).toHaveClass('bg-info/10', 'border-info/40', 'text-info-foreground', 'text-[12px]');
    expect(button).not.toHaveClass('bg-primary');
  });

  it('prefers resume when fresh start and resume are both enabled', async () => {
    setState({ start: true, resume: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session · PAN-2499' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-2499/resume', expect.objectContaining({ method: 'POST' })));
  });

  it('shows a failed spawn inline', async () => {
    setState({ start: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Spawn failed' }), { status: 500 }));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Start work agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Spawn failed');
  });

  it('preserves the cockpit model and harness override panel', () => {
    setState({ start: true });
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Overrides' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Override default harness and model' }));
    expect(screen.getByText('model picker')).toBeInTheDocument();
  });

  it.each([
    ['chip', '▶ Start · PAN-2499'],
    ['inline', 'Start · PAN-2499'],
  ] as const)('renders the %s adoption without the override panel', (surface, label) => {
    setState({ start: true });
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><StartAgentCta issueId="PAN-2499" density="rail" surface={surface} /></QueryClientProvider>);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overrides' })).not.toBeInTheDocument();
  });

  it('renders start as a text-primary quiet link on compact surfaces (style-guide card-footer rule)', () => {
    setState({ start: true });
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><StartAgentCta issueId="PAN-2499" density="rail" surface="chip" /></QueryClientProvider>);
    const button = screen.getByRole('button', { name: '▶ Start · PAN-2499' });
    expect(button).toHaveClass('text-primary');
    expect(button).not.toHaveClass('bg-primary');
  });
});
