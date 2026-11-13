/**
 * PAN-5169: `readConversationInputTarget`'s default `read` routes through
 * `resolveAgentPaneIo`'s strict option — on a Herdr host it never falls
 * back to tmux `capture-pane`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi, beforeEach } from 'vitest';

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

const { readConversationInputTarget } = await import('../conversation-input-target.js');

const SUBAGENT_SELECTED = readFileSync(
  new URL('../../agents/__fixtures__/claude-code-2.1.280/subagent-selected.txt', import.meta.url),
  'utf8',
);
const conv = { tmuxSession: 'conv-x', harness: 'claude-code' };

describe('readConversationInputTarget default read backend', () => {
  beforeEach(() => {
    backend.current = { name: 'herdr' };
    findHerdrAgentPane.mockReset();
    findHerdrAgentPane.mockResolvedValue(null);
    readHerdrPaneText.mockReset();
    capturePaneSpy.mockClear();
  });

  it('resolves unknown and never calls tmux capturePane when Herdr holds no pane', async () => {
    await expect(
      readConversationInputTarget(conv, true, '/s/session.jsonl', { hasSubagentsDir: async () => true }),
    ).resolves.toBe('unknown');
    expect(capturePaneSpy).not.toHaveBeenCalled();
  });

  it('reads the selector through tmux capturePane on a tmux host', async () => {
    backend.current = { name: 'tmux' };
    capturePaneSpy.mockResolvedValue(SUBAGENT_SELECTED);
    await expect(
      readConversationInputTarget(conv, true, '/s/session.jsonl', { hasSubagentsDir: async () => true }),
    ).resolves.toEqual({ subagent: 'Counter run' });
    expect(capturePaneSpy).toHaveBeenCalledWith('conv-x', 60);
  });
});
