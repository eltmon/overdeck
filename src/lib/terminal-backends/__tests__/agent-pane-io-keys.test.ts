/**
 * PAN-4268: resolveAgentPaneIo binds one agent's pane reads and navigation keys
 * to the backend that holds it, and falls back to tmux on a Herdr host whose
 * agent Herdr does not hold — the same fallback deliverAgentMessage takes.
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

describe('resolveAgentPaneIo', () => {
  beforeEach(() => {
    capturePane.mockClear();
    sendKeysAsync.mockClear();
    findHerdrAgentPane.mockReset();
    findHerdrAgentPane.mockResolvedValue(null);
    readHerdrPaneText.mockClear();
    herdrCall.mockClear();
  });

  it('uses tmux capture-pane and send-keys on a tmux host', async () => {
    const io = await resolveAgentPaneIo('conv-x', tmuxHost);
    expect(io.backend).toBe('tmux');
    await expect(io.read(60)).resolves.toBe('tmux screen');
    expect(capturePane).toHaveBeenCalledWith('conv-x', 60);
    await io.sendKey('Down');
    expect(sendKeysAsync).toHaveBeenCalledWith('conv-x', 'Down', 'input-target');
    expect(findHerdrAgentPane).not.toHaveBeenCalled();
  });

  it('uses the Herdr pane on a Herdr host that holds it', async () => {
    findHerdrAgentPane.mockResolvedValue({ paneId: 'p-1', terminalId: 't-1', workspaceId: 'w-1' });
    const io = await resolveAgentPaneIo('conv-x', herdrHost);
    expect(io.backend).toBe('herdr');
    await expect(io.read(60)).resolves.toBe('herdr screen');
    expect(readHerdrPaneText).toHaveBeenCalledWith('p-1', 60, 'visible');
    await io.sendKey('Down');
    expect(herdrCall).toHaveBeenCalledWith('pane.send_keys', { pane_id: 'p-1', keys: ['down'] });
    expect(capturePane).not.toHaveBeenCalled();
    expect(sendKeysAsync).not.toHaveBeenCalled();
  });

  it('falls back to tmux on a Herdr host that holds no pane for the agent', async () => {
    const io = await resolveAgentPaneIo('conv-legacy', herdrHost);
    expect(io.backend).toBe('tmux');
    expect(findHerdrAgentPane).toHaveBeenCalledWith('conv-legacy');
    await io.read(60);
    expect(capturePane).toHaveBeenCalledWith('conv-legacy', 60);
    await io.sendKey('Escape');
    expect(sendKeysAsync).toHaveBeenCalledWith('conv-legacy', 'Escape', 'input-target');
  });
});
