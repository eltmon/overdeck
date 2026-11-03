/** PAN-4473 WI-8: the share dialog's create, signed-out, copy and end states, and the menu item's runsHere gate. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareView } from '@overdeck/contracts';

const api = vi.hoisted(() => ({
  shares: { data: [] as ShareView[] | undefined, isLoading: false, error: null as unknown },
  createShare: vi.fn(),
  endShare: vi.fn(),
  sendShareCommand: vi.fn(),
}));

vi.mock('../shareApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shareApi')>()),
  useShares: () => api.shares,
  createShare: (name: string) => api.createShare(name),
  endShare: (code: string) => api.endShare(code),
  sendShareCommand: (code: string, command: unknown) => api.sendShareCommand(code, command),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import type { Conversation } from '../../../CommandDeck/ConversationList';
import { ShareApiError } from '../shareApi';
import { ShareConversationMenuItem, ShareDialog, useShareDialogStore } from '../ShareDialog';

const SHARE: ShareView = {
  shortCode: 'BCDFGHJK',
  joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
  scope: { kind: 'conversation', conversationId: 'conv-a' },
  createdAt: '2026-11-02T00:00:00.000Z',
  connection: 'connected',
  snapshot: {
    shortCode: 'BCDFGHJK',
    scope: { kind: 'conversation', conversationId: 'conv-a' },
    dataOwner: { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
    controllerGithubId: 1,
    hostConnected: true,
    participants: [],
    blocked: [],
  },
  lastError: null,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  api.shares = { data: [], isLoading: false, error: null };
  api.createShare.mockReset().mockResolvedValue(SHARE);
  api.endShare.mockReset().mockResolvedValue(undefined);
  api.sendShareCommand.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  useShareDialogStore.getState().close();
});

describe('ShareDialog (PAN-4473 WI-8)', () => {
  it('ac1: Create link creates a share for the conversation', async () => {
    wrap(<ShareDialog target={{ name: 'conv-a', title: 'Fix the deploy' }} onClose={vi.fn()} />);
    expect(screen.getByText('Create a link that people can use to ask to join. You admit each person.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create link' })); });
    expect(api.createShare).toHaveBeenCalledWith('conv-a');
  });

  it('ac2: a 412 not_signed_in shows the signed-out panel with pan account login', async () => {
    api.createShare.mockRejectedValueOnce(new ShareApiError(412, 'not_signed_in', 'Sign in with pan account login to share conversations.'));
    wrap(<ShareDialog target={{ name: 'conv-a' }} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create link' })); });
    expect(screen.getByText('Sign in to overdeck.ai to share conversations.')).toBeTruthy();
    expect(screen.getByText('pan account login')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows any other create failure as an alert', async () => {
    api.createShare.mockRejectedValueOnce(new ShareApiError(502, 'share_service_unreachable', 'unreachable'));
    wrap(<ShareDialog target={{ name: 'conv-a' }} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create link' })); });
    expect(screen.getByRole('alert').textContent).toBe('unreachable');
  });

  it('ac3: shows the join link, copies it, and ends the share after confirmation', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    api.shares = { data: [SHARE], isLoading: false, error: null };
    wrap(<ShareDialog target={{ name: 'conv-a' }} onClose={vi.fn()} />);

    expect((screen.getByLabelText('Join link') as HTMLInputElement).value).toBe(SHARE.joinUrl);
    expect(screen.getByText('Connected')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(SHARE.joinUrl);
    expect(toast.success).toHaveBeenCalledWith('Link copied');

    fireEvent.click(screen.getByRole('button', { name: 'End share' }));
    expect(screen.getByText('End this share? Everyone in the room and the lobby is disconnected and the link stops working.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.endShare).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'End share' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm end share' })); });
    expect(api.endShare).toHaveBeenCalledWith('BCDFGHJK');
  });

  it('marks a disconnected share with the amber notice', () => {
    api.shares = { data: [{ ...SHARE, connection: 'disconnected', snapshot: null }], isLoading: false, error: null };
    wrap(<ShareDialog target={{ name: 'conv-a' }} onClose={vi.fn()} />);
    expect(screen.getByText('Disconnected from the share service. End this share and create a new link.')).toBeTruthy();
  });

  it('relays a lobby command for this share', async () => {
    const base = SHARE.snapshot!;
    const lobby = { githubId: 100, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/100', state: 'lobby' as const, contributor: false, connected: true };
    api.shares = { data: [{ ...SHARE, snapshot: { ...base, participants: [lobby] } }], isLoading: false, error: null };
    wrap(<ShareDialog target={{ name: 'conv-a' }} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Admit @alice as contributor' })); });
    expect(api.sendShareCommand).toHaveBeenCalledWith('BCDFGHJK', { type: 'admit', githubId: 100, contributor: true });
  });
});

describe('ShareConversationMenuItem (PAN-4473 WI-8)', () => {
  const conversation = (overrides: Partial<Conversation>) => ({ id: 1, name: 'conv-a', title: 'Fix', ...overrides }) as Conversation;

  it('ac4: renders nothing for a linked or released conversation', () => {
    const linked = render(<ShareConversationMenuItem conversation={conversation({ origin: 'linked' })} />);
    expect(linked.container.innerHTML).toBe('');
    linked.unmount();
    const released = render(<ShareConversationMenuItem conversation={conversation({ releasedTo: '00000000-0000-4000-8000-0000000000bb' })} />);
    expect(released.container.innerHTML).toBe('');
  });

  it('opens the share dialog for a local conversation', () => {
    const onDone = vi.fn();
    render(<ShareConversationMenuItem conversation={conversation({})} onDone={onDone} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share this conversation' }));
    expect(useShareDialogStore.getState().target).toEqual({ name: 'conv-a', title: 'Fix' });
    expect(onDone).toHaveBeenCalled();
  });
});
