/**
 * PAN-4278 root cause (W12): what the Herdr delivery door returns for each
 * candidate that could have eaten the two composer sends of conversation
 * 20260927-3978 at ~15:24 UTC, and what the composer route now answers.
 *
 * Evidence (see the PR's "Root cause"): herdr-server.log has no
 * `agent.prompt` request for either send (every agent.prompt in 15:23–15:26
 * is a spawn kickoff one second after a new pane's agent detection), the
 * tmux cascade's bridge log for the conversation does not exist, and
 * dashboard.log has no line — yet the composer answered 200. So
 * deliverAgentMessage returned before Herdr's agent.prompt without
 * throwing, which only its Herdr branch does: a prompt() that fails before
 * the RPC (client-side socket/connect failure) or a guard refusal, both
 * `{ ok: false, path: 'herdr' }`, which the composer route used to discard.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync } from 'node:fs';

const home = vi.hoisted(() => {
  const dir = `/tmp/pan4278-deliv-${process.pid}`;
  process.env.OVERDECK_HOME = dir;
  process.env.OVERDECK_TERMINAL_BACKEND = 'herdr';
  return dir;
});

const mocks = vi.hoisted(() => ({ findHerdrAgent: vi.fn(), prompt: vi.fn() }));

vi.mock('../../terminal-backends/herdr.js', () => ({
  findHerdrAgent: mocks.findHerdrAgent,
  herdrBackend: { prompt: (...args: unknown[]) => mocks.prompt(...args) },
}));
vi.mock('../../../dashboard/server/http-helpers.js', () => ({
  jsonResponse: vi.fn((body: unknown, options?: number | { status?: number }) => {
    const status = typeof options === 'number' ? options : options?.status ?? 200;
    return { status, body };
  }),
}));

const { deliverAgentMessage, resetDeliveryBackendSelection } = await import('../delivery.js');
const { resetPromptGuard } = await import('../../terminal-backends/prompt-guard.js');
const { createConversation } = await import('../../overdeck/conversations.js');
const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { handleConversationMessage } = await import('../../overdeck/conversation-message.js');

const CONV = 'conv-20260927-3978';

beforeAll(() => {
  mkdirSync(home, { recursive: true });
  createConversation({
    name: '20260927-3978', tmuxSession: CONV, cwd: '/tmp', harness: 'claude-code',
    status: 'active', titleSource: 'manual', title: 'Orca study',
  });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetPromptGuard();
  resetDeliveryBackendSelection();
  mocks.findHerdrAgent.mockReset();
  mocks.prompt.mockReset();
  mocks.findHerdrAgent.mockResolvedValue({
    paneId: 'wA:p1', terminalId: 'term_65c6f40babca233b', workspaceId: 'wA', state: 'working', tokens: {}, paneBound: false,
  });
});

describe('Herdr delivery results for the 15:24 candidates', () => {
  it('candidate 1a: a Herdr client failure before agent.prompt returns ok:false herdr', async () => {
    mocks.prompt.mockReturnValue(Effect.fail(new Error('herdr api: connect ENOENT herdr.sock')));
    const result = await deliverAgentMessage(CONV, 'BTW How can I launch Orca?', 'conversation-message', 'auto');
    expect(result).toMatchObject({ ok: false, path: 'herdr' });
    expect(result.failure).toMatch(/herdr api: connect ENOENT/);
  });

  it('candidate 1b: a Herdr refusal (agent_blocked / guard) returns ok:false herdr', async () => {
    mocks.prompt.mockReturnValue(Effect.succeed({ refused: true, reason: 'agent_blocked' }));
    const result = await deliverAgentMessage(CONV, 'BTW How can I launch Orca?', 'conversation-message', 'auto');
    expect(result).toEqual({ ok: false, path: 'herdr', failure: 'refused: agent_blocked' });
  });

  it('candidate 2 (ruled out, documented contract): a settled-wait stall reports delivered', async () => {
    // herdr.ts maps agent_prompt_stalled / timeout on the agent.prompt RPC to
    // delivered — Herdr already typed the text + Enter. It needs an agent.prompt
    // request, and herdr-server.log shows none for the lost sends.
    mocks.prompt.mockReturnValue(Effect.succeed({ delivered: true, messageId: 'm' }));
    const result = await deliverAgentMessage(CONV, 'BTW How can I launch Orca?', 'conversation-message', 'auto');
    expect(result).toEqual({ ok: true, path: 'herdr' });
  });

  it('candidate 3 (ruled out): a guard drop is a deduplicated success, and the composer sends a fresh id each time', async () => {
    mocks.prompt.mockReturnValue(Effect.succeed({ dropped: true, reason: 'already delivered' }));
    const result = await deliverAgentMessage(CONV, 'BTW How can I launch Orca?', 'conversation-message', 'auto');
    expect(result).toMatchObject({ ok: true, path: 'herdr', deduplicated: true });
    const ids = mocks.prompt.mock.calls.map((call) => (call[2] as { messageId: string }).messageId);
    await deliverAgentMessage(CONV, 'BTW How can I launch Orca?', 'conversation-message', 'auto');
    expect((mocks.prompt.mock.calls[1]![2] as { messageId: string }).messageId).not.toBe(ids[0]);
  });
});

describe('the composer route no longer loses a failed Herdr delivery', () => {
  it('answers 502 not-delivered instead of ok:true when Herdr fails before agent.prompt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.prompt.mockReturnValue(Effect.fail(new Error('herdr api: connect ENOENT herdr.sock')));
    const response = (await handleConversationMessage('20260927-3978', { message: 'Look like a lot of stuff has been merged?' }, {
      resolveSessionFile: async () => null,
      generateAiTitle: async () => {},
      ensureMainInputTarget: async () => ({ ok: true, inputTarget: 'main' }),
      conversationPendingPermission: async () => null,
    })) as unknown as { status: number; body: Record<string, unknown> };
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 'not-delivered', retryable: true, deliveryUnknown: false });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[conversations\] 20260927-3978: not delivered via herdr: /));
    warn.mockRestore();
  });
});
