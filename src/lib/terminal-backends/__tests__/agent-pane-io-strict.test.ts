/**
 * PAN-5169: `resolveAgentPaneIo`'s `legacyTmuxFallback: false` option — a
 * strict read that never falls back to tmux on a Herdr host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalBackend } from '../types.js';

const capturePane = vi.hoisted(() => vi.fn(async (_id: string, _lines?: number) => 'tmux screen'));
const sendKeysAsync = vi.hoisted(() => vi.fn(async (_id: string, _key: string, _caller?: string) => {}));
const findHerdrAgentPane = vi.hoisted(() =>
  vi.fn(async (_id: string): Promise<{ paneId: string; terminalId: string; workspaceId: string } | null> => null),
);
const readHerdrPaneText = vi.hoisted(() => vi.fn(async (_paneId: string, _lines: number, _source?: string) => 'herdr screen'));
const herdrCall = vi.hoisted(() => vi.fn(async (_method: string, _params: unknown) => ({})));

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane,
  sendKeysAsync,
}));
vi.mock('../herdr.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../herdr.js')>()),
  findHerdrAgentPane,
  readHerdrPaneText,
}));
vi.mock('../herdr-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../herdr-api.js')>()),
  getHerdrApiClient: () => ({ call: herdrCall }),
}));

const { resolveAgentPaneIo } = await import('../agent-pane-io.js');

const tmuxHost = { name: 'tmux' } as TerminalBackend;
const herdrHost = { name: 'herdr' } as TerminalBackend;

describe('resolveAgentPaneIo strict option', () => {
  beforeEach(() => {
    capturePane.mockClear();
    sendKeysAsync.mockClear();
    findHerdrAgentPane.mockReset();
    findHerdrAgentPane.mockResolvedValue(null);
    readHerdrPaneText.mockClear();
    herdrCall.mockClear();
  });

  it('rejects instead of falling back when a Herdr host holds no pane and legacyTmuxFallback is false', async () => {
    await expect(resolveAgentPaneIo('conv-x', herdrHost, { legacyTmuxFallback: false })).rejects.toThrow(
      'herdr holds no pane for conv-x',
    );
    expect(capturePane).not.toHaveBeenCalled();
    expect(sendKeysAsync).not.toHaveBeenCalled();
  });

  it('keeps the default tmux fallback when no options are passed', async () => {
    const io = await resolveAgentPaneIo('conv-x', herdrHost);
    expect(io.backend).toBe('tmux');
  });

  it('uses the Herdr pane when the host holds it, even with legacyTmuxFallback: false', async () => {
    findHerdrAgentPane.mockResolvedValue({ paneId: 'p-1', terminalId: 't-1', workspaceId: 'w-1' });
    const io = await resolveAgentPaneIo('conv-x', herdrHost, { legacyTmuxFallback: false });
    expect(io.backend).toBe('herdr');
    await io.read(60);
    expect(readHerdrPaneText).toHaveBeenCalledWith('p-1', 60, 'visible');
  });

  it('uses tmux on a tmux host with legacyTmuxFallback: false, unchanged', async () => {
    const io = await resolveAgentPaneIo('conv-x', tmuxHost, { legacyTmuxFallback: false });
    expect(io.backend).toBe('tmux');
    await io.read(0);
    expect(capturePane).toHaveBeenCalledWith('conv-x', 0);
  });
});
