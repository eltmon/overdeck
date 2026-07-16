import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartAgentCta } from './StartAgentCta';

const useIssueActions = vi.fn();
const useIssueView = vi.fn();
const refreshDashboardState = vi.fn();

vi.mock('../IssueActionMenu/useIssueActions', () => ({ useIssueActions: (...args: unknown[]) => useIssueActions(...args) }));
vi.mock('./useIssueView', () => ({ useIssueView: (...args: unknown[]) => useIssueView(...args) }));
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
  useIssueView.mockReturnValue({
    operator: { needsYou: troubled ? { kind: 'troubled', sessionId: agentId } : paused ? { kind: 'paused', sessionId: agentId } : undefined },
  });
}

function renderCta(density: 'rail' | 'cockpit' | 'console' = 'cockpit') {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><StartAgentCta issueId="PAN-2499" density={density} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
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
    ['troubled', 'troubled flag'],
    ['paused', 'paused gate'],
  ] as const)('names the %s gate and confirms before clearing it', async (kind, copy) => {
    setState({ start: true, [kind]: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Start work agent' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(copy);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear gate and start' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ issueId: 'PAN-2499', projectId: 'overdeck', clearGates: true });
  });

  it('resumes a resumable stopped session through the agent endpoint', async () => {
    setState({ resume: true });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    renderCta();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
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
    ['chip', '▶ Start'],
    ['inline', 'Start'],
  ] as const)('renders the %s adoption without the override panel', (surface, label) => {
    setState({ start: true });
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><StartAgentCta issueId="PAN-2499" density="rail" surface={surface} /></QueryClientProvider>);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overrides' })).not.toBeInTheDocument();
  });
});
