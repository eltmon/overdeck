import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

const confirmMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 't' })),
}));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => confirmMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation, embedded }: { conversation: { name: string }; embedded?: boolean }) => (
    <div data-testid="conversation-panel" data-embedded={String(embedded)}>{conversation.name}</div>
  ),
}));
vi.mock('../../EventRouter', () => ({ EventRouter: () => null }));
vi.mock('../../../hooks/useCodexAutoRetry', () => ({ useCodexAutoRetry: () => undefined }));
vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => <div data-testid="xterminal">{sessionName}</div>,
}));

import { FlywheelConversationPane } from '../FlywheelConversationPane';
import { StandaloneFlywheelPopoutRoute } from '../../../App/StandaloneRoutes';
import { flywheelStatus, renderWithQuery, stubFetch } from './fixtures';

const conversation = { id: 42, name: 'conv-flywheel', tmuxSession: 'conv-flywheel', status: 'active', cwd: '/repos/overdeck', sessionAlive: true };

function setup(run: FlywheelDerivedStatus['run'], opts: { conversation?: boolean } = {}) {
  return stubFetch((url, init) => {
    if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run }));
    if (url === '/api/conversations/conv-flywheel') {
      return opts.conversation === false ? Response.json({ error: 'Conversation not found' }, { status: 404 }) : Response.json(conversation);
    }
    if (url === '/api/settings') return Response.json({ roles: { flywheel: { model: 'claude-opus-5-5', harness: 'claude-code', maxAgents: 6 } } });
    if (url.startsWith('/api/flywheel/') && init?.method === 'POST') return Response.json({ success: true });
    return undefined;
  });
}

const toolbarButtons = () => screen.getByRole('toolbar', { name: 'Flywheel controls' }).querySelectorAll('button');
const labels = () => Array.from(toolbarButtons()).map((b) => b.textContent);

describe('FlywheelConversationPane (PAN-3964 FR-13)', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    window.history.replaceState(null, '', '/flywheel');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the live harness and model from the derived status (PAN-4199 ac1)', async () => {
    setup('running');
    renderWithQuery(<FlywheelConversationPane />);
    expect(await screen.findByTestId('flywheel-live-conversation')).toHaveTextContent('claude-code · claude-opus-5-5');
  });

  it('shows no live conversation line when the flywheel is idle', async () => {
    stubFetch((url) => {
      if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run: 'idle', conversation: null }));
      if (url === '/api/conversations/conv-flywheel') return Response.json({ error: 'not found' }, { status: 404 });
      if (url === '/api/settings') return Response.json({ roles: {} });
      return undefined;
    });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Start' });
    expect(screen.queryByTestId('flywheel-live-conversation')).toBeNull();
  });

  describe('an orphaned session offers Start fresh (PAN-4199 D9)', () => {
    /** Idle, with POST /api/flywheel/start answering `failure` instead of success. */
    function setupFailingStart(failure: { status: number; body: Record<string, unknown> }) {
      return stubFetch((url, init) => {
        if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run: 'idle' }));
        if (url === '/api/conversations/conv-flywheel') return Response.json({ error: 'Conversation not found' }, { status: 404 });
        if (url === '/api/settings') return Response.json({ roles: {} });
        if (url === '/api/flywheel/start' && init?.method === 'POST') return Response.json(failure.body, { status: failure.status });
        if (url.startsWith('/api/flywheel/') && init?.method === 'POST') return Response.json({ success: true });
        return undefined;
      });
    }

    it('reveals Start fresh after a 409 FlywheelOrphanSession (ac1)', async () => {
      setupFailingStart({ status: 409, body: { error: 'A conv-flywheel session is already running', code: 'FlywheelOrphanSession' } });
      renderWithQuery(<FlywheelConversationPane />);
      fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
      await waitFor(() => expect(labels()).toContain('Start fresh'));
    });

    it('Start fresh POSTs { fresh: true } once the confirm is accepted (ac2)', async () => {
      const fetchMock = setupFailingStart({ status: 409, body: { error: 'orphan', code: 'FlywheelOrphanSession' } });
      renderWithQuery(<FlywheelConversationPane />);
      fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/start', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fresh: true }),
      })));
      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('leftover conv-flywheel session'),
      }));
    });

    it('leaves the toolbar alone when the start fails for any other reason (ac3)', async () => {
      setupFailingStart({ status: 500, body: { error: 'boom' } });
      renderWithQuery(<FlywheelConversationPane />);
      fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
      await waitFor(() => expect(labels()).toEqual(['Start', 'Pop out']));
      expect(screen.queryByRole('button', { name: 'Start fresh' })).toBeNull();
    });
  });

  it('idle shows Start; clicking it POSTs /api/flywheel/start', async () => {
    const fetchMock = setup('idle', { conversation: false });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Start' });
    expect(labels()).toEqual(['Start', 'Pop out']);
    expect(screen.getByText('No flywheel conversation yet — Start to create it')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/start', expect.objectContaining({ method: 'POST' })));
  });

  it('running shows Pause, Report, Stop, Abort and embeds the conversation', async () => {
    setup('running');
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Pause' });
    expect(labels()).toEqual(['Pause', 'Report', 'Stop', 'Abort', 'Pop out']);
    expect(await screen.findByTestId('conversation-panel')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByTestId('flywheel-run-config')).toHaveTextContent('claude-opus-5-5');
  });

  it('paused shows Resume and Start fresh; Start fresh confirms and sends fresh:true', async () => {
    const fetchMock = setup('paused');
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Resume' });
    expect(labels()).toEqual(['Resume', 'Start fresh', 'Pop out']);
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/start', expect.objectContaining({ body: JSON.stringify({ fresh: true }) })));
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it.each(['Stop', 'Abort'] as const)('%s asks for confirmation first and does nothing when declined', async (label) => {
    const fetchMock = setup('running');
    confirmMock.mockResolvedValue(false);
    renderWithQuery(<FlywheelConversationPane />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.some(([url]) => String(url) === `/api/flywheel/${label.toLowerCase()}`)).toBe(false);

    confirmMock.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/flywheel/${label.toLowerCase()}`, expect.objectContaining({ method: 'POST' })));
  });

  it('the Terminal toggle mounts XTerminal on conv-flywheel', async () => {
    setup('running');
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByTestId('conversation-panel');
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(screen.getByTestId('xterminal')).toHaveTextContent('conv-flywheel');
  });

  it('the popout route renders the pane without chrome or its own Pop out button', async () => {
    window.history.replaceState(null, '', '/popout/flywheel-conversation');
    setup('running');
    renderWithQuery(<StandaloneFlywheelPopoutRoute />);
    await screen.findByRole('button', { name: 'Pause' });
    expect(labels()).not.toContain('Pop out');
    expect(screen.queryByTestId('sidebar-home')).toBeNull();
  });
});
