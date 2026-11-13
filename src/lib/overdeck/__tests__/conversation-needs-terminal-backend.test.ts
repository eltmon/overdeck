/**
 * PAN-5169: `conversationNeedsTerminal`'s default capture routes through
 * `resolveAgentPaneIo`'s strict read — on a Herdr host it never falls back
 * to tmux `capture-pane`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { LegacyConversation as Conversation } from '../conversations.js';

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const backend = vi.hoisted(() => ({ current: { name: 'herdr' } as { name: 'herdr' | 'tmux' } }));
const findHerdrAgentPane = vi.hoisted(() =>
  vi.fn(async (_id: string): Promise<{ paneId: string; terminalId: string; workspaceId: string } | null> => null),
);
const readHerdrPaneText = vi.hoisted(() => vi.fn(async (_paneId: string, _lines: number, _source?: string) => ''));
const capturePaneSpy = vi.hoisted(() => vi.fn(async (_id: string, _lines?: number) => ''));

vi.mock('../../terminal-backends/launch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/launch.js')>()),
  resolveLaunchBackend: vi.fn(async () => backend.current),
}));
vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/herdr.js')>()),
  findHerdrAgentPane,
  readHerdrPaneText,
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane: capturePaneSpy,
}));

const { conversationNeedsTerminal } = await import('../conversation-reads.js');

const conv = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    name: 'conv-20260714-4261',
    tmuxSession: 'conv-20260714-4261',
    harness: 'claude-code',
    ...overrides,
  }) as Conversation;

const ONBOARDING_PANE =
  'Welcome to Claude Code v2.1.209\n Select login method:\n ❯ 1. Claude account with subscription';

describe('conversationNeedsTerminal default capture backend', () => {
  beforeEach(() => {
    backend.current = { name: 'herdr' };
    findHerdrAgentPane.mockReset();
    findHerdrAgentPane.mockResolvedValue(null);
    readHerdrPaneText.mockReset();
    readHerdrPaneText.mockResolvedValue('');
    capturePaneSpy.mockClear();
  });

  it('resolves false and never calls tmux capturePane when Herdr holds no pane', async () => {
    await expect(conversationNeedsTerminal(conv(), true, null)).resolves.toBe(false);
    expect(capturePaneSpy).not.toHaveBeenCalled();
  });

  it('reads the Herdr pane directly when it holds one', async () => {
    findHerdrAgentPane.mockResolvedValue({ paneId: 'p-1', terminalId: 't-1', workspaceId: 'w-1' });
    readHerdrPaneText.mockResolvedValue(ONBOARDING_PANE);
    await expect(conversationNeedsTerminal(conv(), true, null)).resolves.toBe(true);
    expect(readHerdrPaneText).toHaveBeenCalledWith('p-1', 60, 'visible');
    expect(capturePaneSpy).not.toHaveBeenCalled();
  });

  it('uses tmux capturePane on a tmux host', async () => {
    backend.current = { name: 'tmux' };
    capturePaneSpy.mockResolvedValue(ONBOARDING_PANE);
    await expect(conversationNeedsTerminal(conv(), true, null)).resolves.toBe(true);
    expect(capturePaneSpy).toHaveBeenCalledWith('conv-20260714-4261', 0);
  });
});
