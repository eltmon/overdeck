/**
 * PAN-3917 W12: a pane-bound Herdr agent is delivered to through the HARNESS's
 * own transport, not `agent.prompt`.
 *
 * Herdr can only prompt an agent it detected. A codex / ACP / kimi agent runs
 * behind a host process, so Herdr holds no agent record for its pane and
 * `prompt` answers `unsupported`. That is not a delivery failure — the cascade
 * below it (app-server socket, ACP socket, supervisor, Channels, tmux paste)
 * is exactly how those harnesses were always reached. The guard still runs on
 * the way through: an `unsupported` answer must not become an ungated one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The home must be set BEFORE delivery.ts and its agent-state reads load.
const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/pan3917-w12-${process.pid}`;
  process.env.OVERDECK_HOME = dir;
  process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
  return dir;
});

const mocks = vi.hoisted(() => ({
  findHerdrAgent: vi.fn(),
  prompt: vi.fn(),
  sendKeys: vi.fn(),
  checkPrompt: vi.fn(),
}));

vi.mock('../../../../src/lib/terminal-backends/prompt-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/terminal-backends/prompt-guard.js')>();
  return {
    ...actual,
    // The REAL guard runs; the spy only records that it was consulted, and with
    // which target tokens and sender.
    checkPrompt: (input: Parameters<typeof actual.checkPrompt>[0]) => {
      mocks.checkPrompt(input);
      return actual.checkPrompt(input);
    },
  };
});

vi.mock('../../../../src/lib/terminal-backends/herdr.js', () => ({
  findHerdrAgent: mocks.findHerdrAgent,
  herdrBackend: { prompt: (...args: unknown[]) => mocks.prompt(...args) },
}));

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/tmux.js')>();
  return {
    ...actual,
    sessionExists: () => Effect.succeed(true),
    isPaneDead: () => Effect.succeed(false),
    sendKeys: (agentId: string, message: string) => {
      mocks.sendKeys(agentId, message);
      return Effect.succeed(undefined);
    },
  };
});

const { deliverAgentMessage, resetDeliveryBackendSelection } =
  await import('../../../../src/lib/agents/delivery.js');
const { resetPromptGuard } = await import('../../../../src/lib/terminal-backends/prompt-guard.js');
const { unsupported } = await import('../../../../src/lib/terminal-backends/types.js');

function writeAgentState(agentId: string, state: Record<string, unknown>): void {
  const dir = join(home, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id: agentId, ...state }));
}

beforeEach(() => {
  resetPromptGuard();
  resetDeliveryBackendSelection();
  mocks.findHerdrAgent.mockReset();
  mocks.prompt.mockReset();
  mocks.sendKeys.mockReset();
  mocks.checkPrompt.mockReset();
  mocks.findHerdrAgent.mockResolvedValue({
    paneId: 'wE:p2', terminalId: 't', workspaceId: 'wE', state: 'unknown', tokens: {}, paneBound: true,
  });
  mocks.prompt.mockReturnValue(Effect.succeed(unsupported('herdr has no detected agent in pane wE:p2')));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('deliverAgentMessage never prompts a host-backed harness through Herdr', () => {
  it('skips agent.prompt for a codex app-server target even when Herdr detected the codex process', async () => {
    writeAgentState('agent-pan-3705-review', { issueId: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' });
    // Herdr sees the codex process under the app-server host and reports a
    // detected agent; `agent.prompt` would type the message into the pane and
    // the host's stdin reader would split it into one thread per line.
    mocks.findHerdrAgent.mockResolvedValue({
      paneId: 'wG:p7', terminalId: 't', workspaceId: 'wG', state: 'idle', tokens: { harness: 'codex', role: 'review' }, paneBound: false,
    });
    mocks.prompt.mockReturnValue(Effect.succeed({ kind: 'delivered', messageId: 'm2' }));

    const result = await deliverAgentMessage(
      'agent-pan-3705-review', 'line one\nline two\nline three', 'test', undefined,
      { messageId: 'm2', sender: { id: 'conv-2781' } },
    );

    expect(result.ok).toBe(true);
    expect(result.path).not.toBe('herdr');
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
});

describe('deliverAgentMessage when Herdr cannot prompt the pane', () => {
  it('falls through to the harness transport instead of failing the delivery', async () => {
    writeAgentState('agent-pan-3705-review', { issueId: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' });

    const result = await deliverAgentMessage(
      'agent-pan-3705-review', 'the review verdict', 'test', undefined,
      { messageId: 'm1', sender: { id: 'conv-2781' } },
    );

    expect(result.ok).toBe(true);
    expect(result.path).not.toBe('herdr');
    expect(mocks.sendKeys).toHaveBeenCalledWith('agent-pan-3705-review', 'the review verdict');
  });

  it('runs the guard on the way through, with the target tokens and the real sender', async () => {
    writeAgentState('agent-pan-3705-review', { issueId: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' });

    await deliverAgentMessage(
      'agent-pan-3705-review', 'the review verdict', 'test', undefined,
      { messageId: 'm2', sender: { id: 'agent-pan-9-review', issue: 'PAN-9', role: 'review' } },
    );

    expect(mocks.checkPrompt).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'agent-pan-3705-review',
      targetTokens: { issue: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' },
      sender: { id: 'agent-pan-9-review', issue: 'PAN-9', role: 'review' },
      messageId: 'm2',
    }));
  });

  it('keeps the message-id check: the same id is dropped, not delivered twice', async () => {
    writeAgentState('agent-pan-3705-review', { issueId: 'PAN-3705', role: 'review', harness: 'codex', model: 'gpt-5.6-sol' });
    const send = () => deliverAgentMessage(
      'agent-pan-3705-review', 'the review verdict', 'test', undefined,
      { messageId: 'same-id', sender: { id: 'conv-2781' } },
    );

    await send();
    const repeat = await send();

    expect(repeat.deduplicated).toBe(true);
    expect(mocks.sendKeys).toHaveBeenCalledTimes(1);
  });

  // A Herdr-prompted harness (claude-code); host-backed ones never reach agent.prompt.
  it('still reports a Herdr THROW as a herdr failure — only `unsupported` falls through', async () => {
    writeAgentState('agent-pan-3705-review', { issueId: 'PAN-3705', role: 'review', harness: 'claude-code', model: 'claude-sonnet-5' });
    mocks.prompt.mockReturnValue(Effect.fail(new Error('herdr socket_error')));

    const result = await deliverAgentMessage(
      'agent-pan-3705-review', 'the review verdict', 'test', undefined,
      { messageId: 'm3', sender: { id: 'conv-2781' } },
    );

    expect(result).toMatchObject({ ok: false, path: 'herdr' });
    expect(mocks.sendKeys).not.toHaveBeenCalled();
  });
});
