/** PAN-4475 WI-9: every viewer screen's exact text and controls, and no host content in the lobby. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { JoinState, JoinView, PresencePayload, SharedMessage } from '@overdeck/contracts';

import { JoinApiError, sharedRouteCode } from '../joinApi';
import { SharedConversationView, toChatMessage } from '../SharedConversationView';
import type { SharedJoin } from '../useSharedJoin';

vi.mock('../../ChatMarkdown', () => ({
  ChatMarkdownSettingsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="chat-markdown">{text}</div>,
}));

// The real view needs xterm; this stand-in only starts and stops the watch like it does.
vi.mock('../SharedTerminalView', () => ({
  SharedTerminalView: ({ watch }: { watch: (listener: () => void) => () => void }) => {
    useEffect(() => watch(() => undefined), [watch]);
    return <div data-testid="shared-terminal" />;
  },
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey, estimateSize }: {
    count: number;
    getItemKey?: (index: number) => string;
    estimateSize?: (index: number) => number;
  }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: getItemKey?.(index) ?? index,
      start: index * 40,
      size: estimateSize?.(index) ?? 40,
    })),
    getTotalSize: () => count * 40,
    measure: vi.fn(),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
    resizeItem: vi.fn(),
    elementsCache: new Map(),
    indexFromElement: vi.fn(() => -1),
  }),
}));

const CODE = 'BCDFGHJK';
const MESSAGES: SharedMessage[] = [
  { id: 'm1', role: 'user', text: 'Please fix the flaky test', createdAt: '2026-11-03T00:00:00.000Z' },
  { id: 'm2', role: 'assistant', text: 'Fixed the race in the retry loop', createdAt: '2026-11-03T00:00:01.000Z', completedAt: '2026-11-03T00:00:02.000Z' },
];
const PRESENCE: PresencePayload = {
  controllerGithubId: 1,
  participants: [
    { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1', state: 'admitted', contributor: false, isHost: true },
    { githubId: 100, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/100', state: 'admitted', contributor: false, isHost: false },
    { githubId: 200, login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/200', state: 'lobby', contributor: false, isHost: false },
  ],
  streams: [{ streamId: 'conv-a', label: 'Fix the flaky test', kind: 'conversation' }],
};

function view(state: JoinState): JoinView {
  return { shortCode: CODE, joinUrl: `https://share.overdeck.ai/s/${CODE}`, state, contributor: false, login: 'alice', closeCode: null, error: null };
}

function props(overrides: Partial<SharedJoin> = {}): SharedJoin & { code: string } {
  return {
    code: CODE,
    phase: 'live',
    view: null,
    apiError: null,
    peerPhase: 'waiting',
    messages: [],
    hasHistory: false,
    presence: null,
    notices: [],
    drafts: [],
    myDraft: '',
    setMyDraft: vi.fn(),
    submitPrompt: vi.fn(),
    submitStatus: null,
    draftSentNotice: false,
    selfGithubId: null,
    isController: false,
    sendCommand: vi.fn(async () => undefined),
    sendControllerPrompt: vi.fn(async () => 1),
    join: vi.fn(),
    leave: vi.fn(),
    reconnect: vi.fn(),
    watchTerminal: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function live(state: JoinState, overrides: Partial<SharedJoin> = {}) {
  return props({ view: view(state), ...overrides });
}

const heading = (name: string) => screen.getByRole('heading', { name });
const button = (name: string) => screen.getByRole('button', { name });

describe('SharedConversationView (PAN-4475 WI-9)', () => {
  it('confirm: Join a shared conversation with the identity note and Join', () => {
    const p = props({ phase: 'confirm' });
    render(<SharedConversationView {...p} />);
    expect(heading('Join a shared conversation')).toBeTruthy();
    expect(screen.getByText('The host will see your GitHub name and avatar before letting you in.')).toBeTruthy();
    fireEvent.click(button('Join'));
    expect(p.join).toHaveBeenCalledTimes(1);
    expect(screen.getByText('BCDF-GHJK')).toBeTruthy();
  });

  it('error 412: Sign in to join with the login command', () => {
    render(<SharedConversationView {...props({ phase: 'error', apiError: new JoinApiError(412, 'not_signed_in', 'Sign in') })} />);
    expect(heading('Sign in to join')).toBeTruthy();
    expect(screen.getByText('pan account login')).toBeTruthy();
  });

  it('error events_closed: Lost the connection to your Overdeck with Try again', () => {
    const p = props({ phase: 'error', apiError: new JoinApiError(0, 'events_closed', 'Lost the connection to your Overdeck.') });
    render(<SharedConversationView {...p} />);
    expect(heading('Lost the connection to your Overdeck.')).toBeTruthy();
    fireEvent.click(button('Try again'));
    expect(p.join).toHaveBeenCalledTimes(1);
  });

  it('error other: Could not join with the message and Try again', () => {
    render(<SharedConversationView {...props({ phase: 'error', apiError: new JoinApiError(500, 'share_url_invalid', 'share_url must be https') })} />);
    expect(heading('Could not join')).toBeTruthy();
    expect(screen.getByText('share_url must be https')).toBeTruthy();
    expect(button('Try again')).toBeTruthy();
  });

  it('connecting: Connecting… with Leave', () => {
    const p = live('connecting');
    render(<SharedConversationView {...p} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    fireEvent.click(button('Leave'));
    expect(p.leave).toHaveBeenCalledTimes(1);
  });

  it('lobby: waiting heading, the login, Leave, and no host content even with messages', () => {
    render(<SharedConversationView {...live('lobby', { messages: MESSAGES, hasHistory: true, peerPhase: 'connected' })} />);
    expect(heading('Waiting for the host to let you in')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(button('Leave')).toBeTruthy();
    expect(document.querySelector('[data-testid="shared-conversation-timeline"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Please fix the flaky test');
    expect(document.body.textContent).not.toContain('Fixed the race in the retry loop');
  });

  it('admitted, peer connecting: header and Connecting to the host…', () => {
    render(<SharedConversationView {...live('admitted', { peerPhase: 'connecting', presence: PRESENCE })} />);
    expect(screen.getByText('Connecting to the host…')).toBeTruthy();
    expect(screen.getByText('Fix the flaky test')).toBeTruthy();
    expect(screen.getByText('@owner')).toBeTruthy();
    expect(screen.getByText('1 watching')).toBeTruthy();
    expect(button('Leave')).toBeTruthy();
    expect(document.querySelector('[data-testid="shared-conversation-timeline"]')).toBeNull();
  });

  it('admitted, peer connected: the timeline with both messages', () => {
    render(<SharedConversationView {...live('admitted', { peerPhase: 'connected', presence: PRESENCE, messages: MESSAGES, hasHistory: true })} />);
    const timeline = document.querySelector('[data-testid="shared-conversation-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.textContent).toContain('Please fix the flaky test');
    expect(timeline?.textContent).toContain('Fixed the race in the retry loop');
    expect(button('Leave')).toBeTruthy();
  });

  it('host-disconnected: the banner above the last timeline', () => {
    render(<SharedConversationView {...live('host-disconnected', { peerPhase: 'connected', messages: MESSAGES, hasHistory: true })} />);
    expect(screen.getByText('Host disconnected — reconnecting…')).toBeTruthy();
    expect(document.querySelector('[data-testid="shared-conversation-timeline"]')).not.toBeNull();
    expect(button('Leave')).toBeTruthy();
  });

  it('peer lost while admitted: the lost banner with Reconnect and Leave', () => {
    const p = live('admitted', { peerPhase: 'lost', messages: MESSAGES, hasHistory: true });
    render(<SharedConversationView {...p} />);
    expect(screen.getByText('Connection to the host was lost.')).toBeTruthy();
    fireEvent.click(button('Reconnect'));
    expect(p.reconnect).toHaveBeenCalledTimes(1);
    expect(button('Leave')).toBeTruthy();
  });

  it('kicked: Removed by host with Ask to join again', () => {
    const p = live('kicked');
    render(<SharedConversationView {...p} />);
    expect(heading('Removed by host')).toBeTruthy();
    expect(screen.getByText('You can ask to join again.')).toBeTruthy();
    fireEvent.click(button('Ask to join again'));
    expect(p.join).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull();
  });

  it('revoked: Removed by host, blocked, no controls', () => {
    render(<SharedConversationView {...live('revoked')} />);
    expect(heading('Removed by host')).toBeTruthy();
    expect(screen.getByText('The host blocked you from this share.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    ['ended', 'This share has ended.'],
    ['full', 'This share is full.'],
    ['replaced', 'This share is open in another tab or on another device.'],
  ] as const)('%s: %s with no controls', (state, text) => {
    render(<SharedConversationView {...live(state)} />);
    expect(heading(text)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    ['left', 'You left the shared conversation.'],
    ['is-host', 'This is your own share.'],
  ] as const)('%s: %s with a link back to the dashboard', (state, text) => {
    render(<SharedConversationView {...live(state)} />);
    expect(heading(text)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' }).getAttribute('href')).toBe('/');
  });

  it('replaced-here: the other-tab heading', () => {
    render(<SharedConversationView {...props({ phase: 'replaced-here', view: view('admitted') })} />);
    expect(heading('This share is open in another tab or on another device.')).toBeTruthy();
  });

  it('rejected: the sign-in refusal with the login command', () => {
    render(<SharedConversationView {...live('rejected')} />);
    expect(heading("overdeck.ai did not accept this machine's sign-in.")).toBeTruthy();
    expect(screen.getByText('pan account login')).toBeTruthy();
  });

  it('disconnected: Lost the connection to the share service with Rejoin', () => {
    const p = live('disconnected');
    render(<SharedConversationView {...p} />);
    expect(heading('Lost the connection to the share service.')).toBeTruthy();
    fireEvent.click(button('Rejoin'));
    expect(p.join).toHaveBeenCalledTimes(1);
  });

  it('renders each notice line above the timeline', () => {
    render(<SharedConversationView {...live('admitted', {
      peerPhase: 'connected',
      messages: MESSAGES,
      hasHistory: true,
      notices: [{ kind: 'host_newer' }, { kind: 'scope_unsupported' }, { kind: 'hello_failed', code: 'invalid_hello' }, { kind: 'updates_missed' }],
    })} />);
    expect(screen.getByText('The host is on a newer Overdeck. Some content may not show.')).toBeTruthy();
    expect(screen.getByText('Your Overdeck is too old for this share type. Update Overdeck to join.')).toBeTruthy();
    expect(screen.getByText('Could not start the shared session (invalid_hello).')).toBeTruthy();
    expect(screen.getByText('Some updates were missed. Reconnect to resync.')).toBeTruthy();
  });

  it('sharedRouteCode parses the hash route', () => {
    expect(sharedRouteCode('#/shared/bcdf-ghjk')).toBe(CODE);
    expect(sharedRouteCode('#/shared/BCDFGHJK')).toBe(CODE);
    expect(sharedRouteCode('#/shared/nope')).toBeNull();
    expect(sharedRouteCode('#/conv/BCDFGHJK')).toBeNull();
    expect(sharedRouteCode('')).toBeNull();
  });
});

describe('SharedConversationView terminal toggle (PAN-4477 WI-9)', () => {
  const connected = (overrides: Partial<SharedJoin> = {}) =>
    live('admitted', { peerPhase: 'connected', presence: PRESENCE, messages: MESSAGES, hasHistory: true, ...overrides });

  it('shows Conversation pressed and Terminal unpressed once connected', () => {
    render(<SharedConversationView {...connected()} />);
    expect(screen.getByRole('group', { name: 'Shared view' })).toBeTruthy();
    expect(button('Conversation').getAttribute('aria-pressed')).toBe('true');
    expect(button('Terminal').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-testid="shared-conversation-timeline"]')).not.toBeNull();
  });

  it('Terminal mounts the terminal view and starts the watch; Conversation stops it', () => {
    const stop = vi.fn();
    const p = connected({ watchTerminal: vi.fn(() => stop) });
    render(<SharedConversationView {...p} />);

    fireEvent.click(button('Terminal'));
    expect(screen.getByTestId('shared-terminal')).toBeTruthy();
    expect(document.querySelector('[data-testid="shared-conversation-timeline"]')).toBeNull();
    expect(p.watchTerminal).toHaveBeenCalledTimes(1);
    expect(button('Terminal').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button('Conversation'));
    expect(screen.queryByTestId('shared-terminal')).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('shows no toggle in the lobby or before the peer connects', () => {
    const { unmount } = render(<SharedConversationView {...live('lobby', { messages: MESSAGES })} />);
    expect(screen.queryByTestId('shared-view-toggle')).toBeNull();
    unmount();
    render(<SharedConversationView {...live('admitted', { peerPhase: 'connecting' })} />);
    expect(screen.queryByTestId('shared-view-toggle')).toBeNull();
  });
});

describe('SharedConversationView composer (PAN-4476 WI-13)', () => {
  const connected = (overrides: Partial<SharedJoin> = {}, contributor = false) =>
    props({
      view: { ...view('admitted'), contributor },
      peerPhase: 'connected',
      presence: PRESENCE,
      messages: MESSAGES,
      hasHistory: true,
      ...overrides,
    });

  it('a contributor sees Write a prompt and Send prompt, which submits', () => {
    const submitPrompt = vi.fn();
    render(<SharedConversationView {...connected({ myDraft: 'Run the tests', submitPrompt }, true)} />);
    expect(screen.getByRole('textbox', { name: 'Write a prompt' })).toBeTruthy();
    fireEvent.click(button('Send prompt'));
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('a contributor sends with Ctrl+Enter and cannot send a command prefix', () => {
    const submitPrompt = vi.fn();
    const { rerender } = render(<SharedConversationView {...connected({ myDraft: 'Run it', submitPrompt }, true)} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Write a prompt' }), { key: 'Enter', ctrlKey: true });
    expect(submitPrompt).toHaveBeenCalledTimes(1);
    rerender(<SharedConversationView {...connected({ myDraft: '/clear', submitPrompt }, true)} />);
    expect((button('Send prompt') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Prompts cannot start with /, ! or #.')).toBeTruthy();
  });

  it('shows no prefix hint for a blank box and a plain failure line for a rejected status without a reason', () => {
    render(<SharedConversationView {...connected({ myDraft: '   ', submitStatus: { clientId: 'c1', status: 'rejected' } }, true)} />);
    expect((button('Send prompt') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Prompts cannot start with /, ! or #.')).toBeNull();
    expect(screen.getByText('Your prompt was not sent.')).toBeTruthy();
  });

  it('a non-contributor gets a suggestion box and no Send prompt', () => {
    const setMyDraft = vi.fn();
    render(<SharedConversationView {...connected({ setMyDraft })} />);
    expect(screen.queryByRole('button', { name: 'Send prompt' })).toBeNull();
    expect(screen.getByText('The host can pick your suggestion and send it.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Suggest a prompt' }), { target: { value: 'idea' } });
    expect(setMyDraft).toHaveBeenCalledWith('idea');
  });

  it('shows the queue line from presence', () => {
    const presence = { ...PRESENCE, streams: [{ ...PRESENCE.streams[0]!, agentWorking: true, queued: 2 }] };
    render(<SharedConversationView {...connected({ presence })} />);
    expect(screen.getByText('Agent is working · 2 queued')).toBeTruthy();
  });

  it('shows the other drafts with their avatars, the ack and the draft-sent notice', () => {
    render(<SharedConversationView {...connected({
      drafts: [{ authorGithubId: 100, authorLogin: 'alice', text: 'Try the fix', updatedAt: 1 }],
      submitStatus: { clientId: 'c1', status: 'rejected', reason: 'grant_revoked' },
      draftSentNotice: true,
    })} />);
    const row = screen.getByRole('listitem', { name: 'Suggestion from @alice' });
    expect(row.textContent).toContain('Try the fix');
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/100');
    expect(screen.getByText('You can no longer send prompts directly.')).toBeTruthy();
    expect(screen.getByText('The host sent your suggestion.')).toBeTruthy();
  });

  it('shows Queued (#N) for a queued ack', () => {
    render(<SharedConversationView {...connected({ submitStatus: { clientId: 'c1', status: 'queued', position: 3 } }, true)} />);
    expect(screen.getByText('Queued (#3)')).toBeTruthy();
  });

  it('a lobby view renders no textarea', () => {
    render(<SharedConversationView {...props({ view: view('lobby'), messages: MESSAGES, hasHistory: true })} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('toChatMessage copies author', () => {
    const author = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/100' };
    expect(toChatMessage({ ...MESSAGES[0]!, author }).author).toEqual(author);
    expect(toChatMessage(MESSAGES[0]!)).not.toHaveProperty('author');
  });
});

describe('SharedConversationView controller (PAN-4478 WI-9)', () => {
  const ALICE_CONTROLS: PresencePayload = { ...PRESENCE, controllerGithubId: 100 };
  const controller = (overrides: Partial<SharedJoin> = {}) =>
    props({
      view: view('admitted'),
      peerPhase: 'connected',
      presence: ALICE_CONTROLS,
      messages: MESSAGES,
      hasHistory: true,
      selfGithubId: 100,
      isController: true,
      ...overrides,
    });
  const panel = () => document.querySelector('[data-component="shared-controller"]');

  it('shows the controller panel only for the controller and sends Admit @bob as a command', () => {
    const sendCommand = vi.fn(async () => undefined);
    const { rerender } = render(<SharedConversationView {...controller({ isController: false, selfGithubId: 200 })} />);
    expect(panel()).toBeNull();
    rerender(<SharedConversationView {...controller({ sendCommand })} />);
    expect(panel()).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'You have control' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Blocked/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /@alice/ })).toBeNull();
    fireEvent.click(button('Admit @bob'));
    expect(sendCommand).toHaveBeenCalledWith({ type: 'admit', githubId: 200 });
  });

  it('Hand control back sends set-controller with the host\'s id', () => {
    const sendCommand = vi.fn(async () => undefined);
    render(<SharedConversationView {...controller({ sendCommand })} />);
    fireEvent.click(button('Hand control back to @owner'));
    expect(sendCommand).toHaveBeenCalledWith({ type: 'set-controller', githubId: 1 });
  });

  it('the controller\'s Send uses sendControllerPrompt and clears the box', async () => {
    const sendControllerPrompt = vi.fn(async () => 2);
    const setMyDraft = vi.fn();
    render(<SharedConversationView {...controller({ myDraft: 'Run the tests', sendControllerPrompt, setMyDraft })} />);
    expect(screen.getByRole('textbox', { name: 'Write a prompt' })).toBeTruthy();
    await act(async () => { fireEvent.click(button('Send prompt')); });
    expect(sendControllerPrompt).toHaveBeenCalledWith('Run the tests');
    expect(setMyDraft).toHaveBeenCalledWith('');
    expect(screen.getByText('Queued (#2)')).toBeTruthy();
  });

  it('a rejected controller send shows its message and keeps the text', async () => {
    const sendControllerPrompt = vi.fn(async () => { throw new Error('The queue is full. Try again later.'); });
    const setMyDraft = vi.fn();
    render(<SharedConversationView {...controller({ myDraft: 'Go', sendControllerPrompt, setMyDraft })} />);
    await act(async () => { fireEvent.click(button('Send prompt')); });
    expect(sendControllerPrompt).toHaveBeenCalledWith('Go');
    expect(screen.getByText('The queue is full. Try again later.')).toBeTruthy();
    expect(setMyDraft).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Write a prompt' }) as HTMLTextAreaElement).value).toBe('Go');
  });

  it('the controller can pick a suggestion and send it for its author', async () => {
    const sendControllerPrompt = vi.fn(async () => 1);
    render(<SharedConversationView {...controller({
      drafts: [{ authorGithubId: 200, authorLogin: 'bob', text: 'Lint it', updatedAt: 1 }],
      sendControllerPrompt,
    })} />);
    fireEvent.click(button('Use suggestion from @bob'));
    await act(async () => { fireEvent.click(button('Send suggestion from @bob')); });
    expect(sendControllerPrompt).toHaveBeenCalledWith('Lint it', 200);
  });

  it('a rejected command shows its message', async () => {
    const sendCommand = vi.fn(async () => { throw new Error('That person is no longer in the room.'); });
    render(<SharedConversationView {...controller({ sendCommand })} />);
    await act(async () => { fireEvent.click(button('Revoke @bob')); });
    expect((await screen.findByRole('alert')).textContent).toBe('That person is no longer in the room.');
  });

  it('every viewer sees "@alice has control" while a viewer controls', () => {
    const { rerender } = render(<SharedConversationView {...controller({ isController: false, selfGithubId: 200 })} />);
    expect(screen.getByText('@alice has control')).toBeTruthy();
    rerender(<SharedConversationView {...controller({ isController: false, selfGithubId: 200, presence: PRESENCE })} />);
    expect(screen.queryByText(/has control/)).toBeNull();
  });
});
