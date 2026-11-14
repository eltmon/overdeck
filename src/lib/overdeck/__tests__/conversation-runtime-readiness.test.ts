/**
 * PAN-3921 FR-10: conversation readiness reads the pane through the host's
 * terminal backend, so a conversation on a Herdr pane (no tmux session) still
 * becomes ready.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const readAgentPaneText = vi.hoisted(() => vi.fn(async (_agentId: string, _lines: number, _backend?: unknown, _source?: string) => ''));
const capturePane = vi.hoisted(() => vi.fn(async () => ''));

vi.mock('../../terminal-backends/agent-pane-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/agent-pane-io.js')>()),
  readAgentPaneText,
  probeAgentPane: vi.fn(async () => 'present'),
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  capturePane,
}));
// Pass-through spies: the real waiters run unless a case stubs them (PAN-4562).
vi.mock('../../agents/runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/runtime-command.js')>();
  return {
    ...actual,
    waitForPromptReady: vi.fn(actual.waitForPromptReady),
    waitForHostReady: vi.fn(actual.waitForHostReady),
    waitForCodexAppServerReady: vi.fn(actual.waitForCodexAppServerReady),
  };
});
vi.mock('../claude-readiness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../claude-readiness.js')>();
  return { ...actual, waitForClaudeReady: vi.fn(actual.waitForClaudeReady) };
});
vi.mock('../../agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents.js')>();
  return { ...actual, waitForReadySignal: vi.fn(actual.waitForReadySignal) };
});

const { piFamilyNotReadyMessage, waitForConversationRuntimeReady, waitForPiTuiReady } = await import('../conversation-runtime.js');
const { waitForPromptReady, waitForHostReady, waitForCodexAppServerReady } = await import('../../agents/runtime-command.js');
const { waitForClaudeReady } = await import('../claude-readiness.js');
const { waitForReadySignal } = await import('../../agents.js');

beforeEach(() => {
  readAgentPaneText.mockReset();
  capturePane.mockClear();
});

describe('conversation readiness on the host backend (PAN-3921)', () => {
  it('reads the ohmypi TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('❯ ');
    await expect(waitForPiTuiReady('conv-x', 5_000)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 40, undefined, 'visible');
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('reads pi 0.85\'s TUI as ready from its footer (no prompt glyph, PAN-5212)', async () => {
    // Captured from a live pi 0.85.0 TUI pane: the editor box has no ❯ line.
    readAgentPaneText.mockResolvedValue([
      '────────────────────────────────────────',
      '~/Projects/hoff-pan-5212 (feature/pan-5212)',
      '0.0%/131k (auto)                    (openrouter) openai/gpt-oss-20b • low',
    ].join('\n'));
    await expect(waitForPiTuiReady('conv-pi', 5_000)).resolves.toBe(true);
  });

  it('keeps polling while the pane cannot be read yet', async () => {
    readAgentPaneText
      .mockRejectedValueOnce(new Error('herdr holds no pane for conv-x'))
      .mockResolvedValue('❯ ');
    await expect(waitForPiTuiReady('conv-x', 5_000)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledTimes(2);
  });

  it('waits for the Claude Code prompt through the backend pane reader on spawn', async () => {
    readAgentPaneText.mockResolvedValue('❯ ');
    await waitForConversationRuntimeReady('conv-x', 'claude-code', 'spawn');
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 200, undefined, 'visible');
    expect(capturePane).not.toHaveBeenCalled();
  });

  it('waits for the Kimi Code TUI through the backend pane reader', async () => {
    readAgentPaneText.mockResolvedValue('│ > │\ncontext: 0% (0/262k)');
    await expect(waitForPromptReady('conv-x', 'kimi-code', 5)).resolves.toBe(true);
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 80, undefined, 'visible');
    expect(capturePane).not.toHaveBeenCalled();
  });
});

describe('pi conversation readiness (PAN-5223)', () => {
  // The exact pane text of a dashboard-created pi 0.85 conversation: changelog
  // banner, extension-package warning, update notice, then the footer.
  const startupPane = readFileSync(join(import.meta.dirname, 'fixtures', 'pi-0.85-startup-pane.txt'), 'utf8');
  let home: string;
  let originalHome: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-5223-ready-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves as soon as the extension writes ready.json, with no pane text at all', async () => {
    // Herdr's pane reader returns '' today; the ready file must carry pi on its own.
    readAgentPaneText.mockResolvedValue('');
    mkdirSync(join(home, 'agents', 'conv-pi'), { recursive: true });
    writeFileSync(join(home, 'agents', 'conv-pi', 'ready.json'), '{"sessionId":"s"}');
    const started = Date.now();
    await expect(waitForPiTuiReady('conv-pi', 5_000, 'pi')).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(readAgentPaneText).not.toHaveBeenCalled();
  });

  it('reads the pi startup pane (banners, warnings, footer) as ready through the text fallback', async () => {
    readAgentPaneText.mockResolvedValue(startupPane);
    await expect(waitForPiTuiReady('conv-pi', 5_000, 'pi')).resolves.toBe(true);
  });

  it('does not treat ready.json as ready for omp, whose TUI wait also covers MCP startup', async () => {
    readAgentPaneText.mockResolvedValue('');
    mkdirSync(join(home, 'agents', 'conv-omp'), { recursive: true });
    writeFileSync(join(home, 'agents', 'conv-omp', 'ready.json'), '{"sessionId":"s"}');
    await expect(waitForPiTuiReady('conv-omp', 600, 'ohmypi')).resolves.toBe(false);
  });

  it('names the real harness when a pi-family launch never becomes ready', () => {
    expect(piFamilyNotReadyMessage('conv-pi', 'pi')).toMatch(/^Pi \(pi\) did not become interactive in conv-pi .*ready\.json/);
    expect(piFamilyNotReadyMessage('conv-omp', 'ohmypi')).toMatch(/^Oh My Pi \(ohmypi\) did not become interactive/);
  });
});

describe('readiness dispatches on the declared readinessKind (PAN-4562)', () => {
  beforeEach(() => {
    vi.mocked(waitForPromptReady).mockClear().mockResolvedValueOnce(true);
    vi.mocked(waitForHostReady).mockClear().mockResolvedValueOnce(undefined);
    vi.mocked(waitForCodexAppServerReady).mockClear().mockResolvedValueOnce(undefined);
    vi.mocked(waitForClaudeReady).mockClear().mockResolvedValueOnce(undefined);
    vi.mocked(waitForReadySignal).mockClear().mockResolvedValueOnce(true);
    readAgentPaneText.mockResolvedValue('❯ ');
  });

  const waiterCalls = () => ({
    prompt: vi.mocked(waitForPromptReady).mock.calls.map((call) => call.slice(0, 3)),
    host: vi.mocked(waitForHostReady).mock.calls.map((call) => call.slice(0, 3)),
    codexAppServer: vi.mocked(waitForCodexAppServerReady).mock.calls.map((call) => call.slice(0, 2)),
    claude: vi.mocked(waitForClaudeReady).mock.calls,
    signal: vi.mocked(waitForReadySignal).mock.calls,
  });
  const none = { prompt: [], host: [], codexAppServer: [], claude: [], signal: [] };

  it.each([
    ['muse', 'spawn', { ...none, prompt: [['conv-x', 'muse', 60]] }],
    ['acp', 'spawn', { ...none, host: [['conv-x', 'acp', 30]] }],
    ['opencode', 'spawn', { ...none, host: [['conv-x', 'acp', 30]] }],
    ['prime-agent', 'spawn', { ...none, host: [['conv-x', 'prime-agent', 60]] }],
    ['kimi-code', 'spawn', { ...none, prompt: [['conv-x', 'kimi-code', 30]] }],
    // PAN-4903: the default app-server transport waits for the host before the first message.
    ['codex', 'spawn', { ...none, codexAppServer: [['conv-x', 60]] }],
    ['codex', 'respawn', { ...none, codexAppServer: [['conv-x', 60]] }],
    ['claude-code', 'spawn', { ...none, claude: [['conv-x']] }],
    ['claude-code', 'respawn', { ...none, signal: [['conv-x', 30]] }],
  ] as const)('%s (%s) runs only its declared waiter', async (harness, mode, expected) => {
    await waitForConversationRuntimeReady('conv-x', harness, mode);
    expect(waiterCalls()).toEqual(expected);
  });

  it('ohmypi waits on the Pi TUI pane and runs no other waiter', async () => {
    readAgentPaneText.mockClear();
    await waitForConversationRuntimeReady('conv-x', 'ohmypi', 'spawn');
    expect(readAgentPaneText).toHaveBeenCalledWith('conv-x', 40, undefined, 'visible');
    expect(waiterCalls()).toEqual(none);
  });

  it('a muse prompt that never appears fails with the Muse error', async () => {
    vi.mocked(waitForPromptReady).mockReset().mockResolvedValueOnce(false);
    await expect(waitForConversationRuntimeReady('conv-x', 'muse', 'spawn')).rejects.toThrow('Muse Code did not become interactive within 60 seconds');
  });
});
