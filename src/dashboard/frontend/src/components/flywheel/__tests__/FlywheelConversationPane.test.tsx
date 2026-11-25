import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

const confirmMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 't' })),
}));
vi.mock('../../DialogProvider', () => ({ useConfirm: () => confirmMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../chat/ConversationPanel', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    ConversationPanel: ({
      conversation, embedded, targetMessageId, targetMessageNonce, onTargetMessageHandled,
    }: {
      conversation: { name: string };
      embedded?: boolean;
      targetMessageId?: string;
      targetMessageNonce?: number;
      onTargetMessageHandled?: () => void;
    }) => {
      const { data } = useQuery<{ messages: Array<{ id: string; text: string }> }>({
        queryKey: ['conversation-messages', conversation.name],
        queryFn: () => new Promise(() => {}),
        enabled: false,
      });
      return (
        <div
          data-testid="conversation-panel"
          data-embedded={String(embedded)}
          data-target-id={targetMessageId ?? ''}
          data-target-nonce={targetMessageNonce ?? ''}
        >
          {conversation.name}
          {(data?.messages ?? []).map((m) => <p key={m.id} data-testid="mock-message">{m.text}</p>)}
          <button type="button" data-testid="mock-target-handled" onClick={() => onTargetMessageHandled?.()}>target-handled</button>
        </div>
      );
    },
  };
});
vi.mock('../../EventRouter', () => ({ EventRouter: () => null }));
vi.mock('../../../hooks/useCodexAutoRetry', () => ({ useCodexAutoRetry: () => undefined }));
vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => <div data-testid="xterminal">{sessionName}</div>,
}));

import { FlywheelConversationPane } from '../FlywheelConversationPane';
import { StandaloneFlywheelPopoutRoute } from '../../../App/StandaloneRoutes';
import { claimFlywheelTranscriptCache, flywheelRunIdentity, FLYWHEEL_CONVERSATION_QUERY_KEY } from '../../../lib/flywheelApi';
import { useComposerStore } from '../../../lib/composerStore';
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

  // PAN-5666: the confirm names what the new loop keeps and drops, and
  // recommends Resume when the paused run did not stop cleanly.
  it('Start fresh names the tick and needs-you items it keeps and recommends Resume after an unclean stop', async () => {
    stubFetch((url, init) => {
      if (url === '/api/flywheel/status') {
        return Response.json(flywheelStatus({
          run: 'paused',
          lastTick: { tick: 131, pick: null, phase: 'watch', inFlight: ['PAN-5649'], needsYou: 'rotate secrets; Semgrep tiers', at: '2026-09-23T09:59:40.000Z' },
        }));
      }
      if (url === '/api/conversations/conv-flywheel') return Response.json(conversation);
      if (url === '/api/settings') return Response.json({ roles: {} });
      if (url.startsWith('/api/flywheel/') && init?.method === 'POST') return Response.json({ success: true });
      return undefined;
    });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Resume' });
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
    const { message } = (confirmMock.mock.calls[0] as unknown as [{ message: string }])[0];
    expect(message).toContain('keeps only tick 131');
    expect(message).toContain('2 open needs-you items');
    expect(message).toContain('did not stop cleanly, so Resume is recommended');
  });

  it('Start fresh does not recommend Resume after a clean stop', async () => {
    stubFetch((url, init) => {
      if (url === '/api/flywheel/status') {
        return Response.json(flywheelStatus({
          run: 'paused',
          lastTick: { tick: 40, pick: null, phase: 'stopping', inFlight: [], needsYou: null, at: '2026-09-23T09:59:40.000Z' },
        }));
      }
      if (url === '/api/conversations/conv-flywheel') return Response.json(conversation);
      if (url === '/api/settings') return Response.json({ roles: {} });
      if (url.startsWith('/api/flywheel/') && init?.method === 'POST') return Response.json({ success: true });
      return undefined;
    });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Resume' });
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledOnce());
    const { message } = (confirmMock.mock.calls[0] as unknown as [{ message: string }])[0];
    expect(message).toContain('keeps only tick 40');
    expect(message).not.toContain('Resume is recommended');
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

describe('a starting message replaces the panel while a start is pending (PAN-5665)', () => {
  it('Start fresh shows "Starting a fresh Flywheel…" and no panel until the POST resolves', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    const postPromise = new Promise<Response>((resolve) => { resolvePost = resolve; });
    stubFetch((url, init) => {
      if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run: 'paused' }));
      if (url === '/api/conversations/conv-flywheel') return Response.json(conversation);
      if (url === '/api/settings') return Response.json({ roles: { flywheel: { model: 'claude-opus-5-5', harness: 'claude-code', maxAgents: 6 } } });
      if (url === '/api/flywheel/start' && init?.method === 'POST') return postPromise;
      return undefined;
    });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Resume' });
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));

    expect(await screen.findByTestId('flywheel-starting')).toHaveTextContent('Starting a fresh Flywheel…');
    expect(screen.queryByTestId('conversation-panel')).toBeNull();

    await act(async () => {
      resolvePost?.(Response.json({ success: true }));
      await postPromise;
    });

    await waitFor(() => expect(screen.queryByTestId('flywheel-starting')).toBeNull());
    expect(await screen.findByTestId('conversation-panel')).toBeInTheDocument();
  });

  it('plain Start shows "Starting the Flywheel…"', async () => {
    const postPromise = new Promise<Response>(() => {});
    stubFetch((url, init) => {
      if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run: 'idle' }));
      if (url === '/api/conversations/conv-flywheel') return Response.json({ error: 'Conversation not found' }, { status: 404 });
      if (url === '/api/settings') return Response.json({ roles: {} });
      if (url === '/api/flywheel/start' && init?.method === 'POST') return postPromise;
      return undefined;
    });
    renderWithQuery(<FlywheelConversationPane />);
    await screen.findByRole('button', { name: 'Start' });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByTestId('flywheel-starting')).toHaveTextContent('Starting the Flywheel…');
  });
});

describe('a new run never shows the previous run (PAN-5665)', () => {
  const conversationA = { id: 42, name: 'conv-flywheel', tmuxSession: 'conv-flywheel', status: 'active', cwd: '/repos/overdeck', sessionAlive: true, createdAt: '2026-11-25T08:00:00.000Z' };
  const conversationB = { ...conversationA, createdAt: '2026-11-25T09:00:00.000Z' };

  function setupWithConversation(getConversation: () => typeof conversationA) {
    return stubFetch((url, init) => {
      if (url === '/api/flywheel/status') return Response.json(flywheelStatus({ run: 'running' }));
      if (url === '/api/conversations/conv-flywheel') return Response.json(getConversation());
      if (url === '/api/settings') return Response.json({ roles: { flywheel: { model: 'claude-opus-5-5', harness: 'claude-code', maxAgents: 6 } } });
      if (url.startsWith('/api/flywheel/') && init?.method === 'POST') return Response.json({ success: true });
      return undefined;
    });
  }

  it('same id, new createdAt: the previous run\'s cached message and subagent transcript disappear', async () => {
    let current = conversationA;
    setupWithConversation(() => current);
    const { client } = renderWithQuery(<FlywheelConversationPane />);
    await screen.findByTestId('conversation-panel');

    client.setQueryData(['conversation-messages', 'conv-flywheel'], {
      messages: [{ id: 'm1', role: 'assistant', text: 'old run tick 131', createdAt: '2026-11-25T08:05:00.000Z' }],
    });
    client.setQueryData(['conversation-messages', 'conv-flywheel', 'subagent', 'a1'], {
      messages: [{ id: 's1', role: 'assistant', text: 'sub transcript', createdAt: '2026-11-25T08:05:00.000Z' }],
    });
    await screen.findByText('old run tick 131');

    current = conversationB;
    await act(async () => {
      await client.refetchQueries({ queryKey: FLYWHEEL_CONVERSATION_QUERY_KEY });
    });

    await waitFor(() => expect(screen.queryByText('old run tick 131')).toBeNull());
    expect(client.getQueryData(['conversation-messages', 'conv-flywheel'])).toBeUndefined();
    expect(client.getQueryData(['conversation-messages', 'conv-flywheel', 'subagent', 'a1'])).toBeUndefined();
    expect(screen.getByTestId('conversation-panel')).toHaveTextContent('conv-flywheel');
  });

  it('same row: refetching the unchanged row keeps the cached message', async () => {
    const current = conversationA;
    setupWithConversation(() => current);
    const { client } = renderWithQuery(<FlywheelConversationPane />);
    await screen.findByTestId('conversation-panel');

    client.setQueryData(['conversation-messages', 'conv-flywheel'], {
      messages: [{ id: 'm1', role: 'assistant', text: 'old run tick 131', createdAt: '2026-11-25T08:05:00.000Z' }],
    });
    await screen.findByText('old run tick 131');

    await act(async () => {
      await client.refetchQueries({ queryKey: FLYWHEEL_CONVERSATION_QUERY_KEY });
    });

    await screen.findByText('old run tick 131');
  });
});

describe('claimFlywheelTranscriptCache (PAN-5665)', () => {
  afterEach(() => {
    useComposerStore.setState({ byConversation: {} });
  });

  it('flywheelRunIdentity combines id and createdAt, falling back to an empty createdAt', () => {
    expect(flywheelRunIdentity({ id: 42, createdAt: 'X' })).toBe('42:X');
    expect(flywheelRunIdentity({ id: 42 })).toBe('42:');
  });

  it('a first claim returns true and clears the messages, subagent and about caches', () => {
    const client = new QueryClient();
    client.setQueryData(['conversation-messages', 'conv-flywheel'], { messages: ['m1'] });
    client.setQueryData(['conversation-messages', 'conv-flywheel', 'subagent', 'a1'], { messages: ['m2'] });
    client.setQueryData(['conversation-about', 'conv-flywheel'], { summary: 'old run' });

    expect(claimFlywheelTranscriptCache(client, '42:A')).toBe(true);
    expect(client.getQueryData(['conversation-messages', 'conv-flywheel'])).toBeUndefined();
    expect(client.getQueryData(['conversation-messages', 'conv-flywheel', 'subagent', 'a1'])).toBeUndefined();
    expect(client.getQueryData(['conversation-about', 'conv-flywheel'])).toBeUndefined();
  });

  it('a repeated claim of the same identity returns false and removes nothing', () => {
    const client = new QueryClient();
    claimFlywheelTranscriptCache(client, '42:A');
    client.setQueryData(['conversation-messages', 'conv-flywheel'], { messages: ['seeded'] });

    expect(claimFlywheelTranscriptCache(client, '42:A')).toBe(false);
    expect(client.getQueryData(['conversation-messages', 'conv-flywheel'])).toEqual({ messages: ['seeded'] });
  });

  it('a first claim on an unknown owner keeps composer state; a changed owner resets it', () => {
    const client = new QueryClient();
    useComposerStore.getState().addOptimistic('conv-flywheel', 'old echo', 0);
    useComposerStore.getState().addCommandResult('conv-flywheel', '/pan status', {
      kind: 'captured', status: 'completed', command: '/pan status', output: 'ok', truncated: false,
    });
    useComposerStore.getState().holdSend('conv-flywheel', 'held text', { clientMessageId: 'h1' });
    useComposerStore.getState().failSend('conv-flywheel', 'rejected text');

    claimFlywheelTranscriptCache(client, '42:A');
    const afterFirstClaim = useComposerStore.getState().byConversation['conv-flywheel']!;
    expect(afterFirstClaim.optimistic).toHaveLength(1);
    expect(afterFirstClaim.commandResults).toHaveLength(1);
    expect(afterFirstClaim.failed).toHaveLength(2);

    claimFlywheelTranscriptCache(client, '42:B');
    const afterSecondClaim = useComposerStore.getState().byConversation['conv-flywheel']!;
    expect(afterSecondClaim.optimistic).toEqual([]);
    expect(afterSecondClaim.commandResults).toEqual([]);
    const held = afterSecondClaim.failed.find((failed) => failed.clientMessageId === 'h1')!;
    expect(held.code).toBe('cancelled');
    expect(held.heldOffline).toBeUndefined();
    const rejected = afterSecondClaim.failed.find((failed) => failed.text === 'rejected text')!;
    expect(rejected.code).not.toBe('cancelled');
  });
});
