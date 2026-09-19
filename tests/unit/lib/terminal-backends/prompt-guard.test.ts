import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Effect } from 'effect';

import {
  checkPrompt,
  isOperatorConversation,
  resetPromptGuard,
  senderFromEnv,
  PROMPT_DEDUPE_WINDOW_MS,
} from '../../../../src/lib/terminal-backends/prompt-guard.js';
import type { PaneTokens, PromptSender } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 FR-17 / AC-8. On 2026-09-18 a work agent received the same review
 * message four to five times and changed course on claims sent by reviewer
 * conversations. Both adapters run this guard inside `prompt`.
 */

const WORKER_TOKENS: Partial<PaneTokens> = {
  issue: 'MIN-1039',
  role: 'worker',
  harness: 'claude-code',
  model: 'claude-opus-5',
};

const FOREMAN: PromptSender = { id: 'agent-min-1039', issue: 'MIN-1039', role: 'work' };
const REVIEWER: PromptSender = { id: 'agent-min-1039-review', issue: 'MIN-1039', role: 'review' };
const OPERATOR: PromptSender = { id: 'conv-2781' };

beforeEach(() => {
  resetPromptGuard();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('prompt guard — idempotence', () => {
  it('drops the second delivery of the same message id to the same target', () => {
    const input = { targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-1' };
    expect(checkPrompt(input)).toEqual({ allow: true });
    const second = checkPrompt(input);
    expect(second).toMatchObject({ dropped: true });
    expect('reason' in second && second.reason).toContain('msg-1');
  });

  it('keeps rings per target: the same id to another pane is delivered', () => {
    checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-1' });
    expect(
      checkPrompt({ targetId: 'w1:p3', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-1' }),
    ).toEqual({ allow: true });
  });

  it('forgets an id once the window has passed', () => {
    const now = 1_000_000;
    checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-1', now });
    expect(
      checkPrompt({
        targetId: 'w1:p2',
        targetTokens: WORKER_TOKENS,
        sender: FOREMAN,
        messageId: 'msg-1',
        now: now + PROMPT_DEDUPE_WINDOW_MS + 1,
      }),
    ).toEqual({ allow: true });
  });

  it('bounds the ring so a long-lived target cannot grow without limit', () => {
    for (let i = 0; i < 200; i += 1) {
      checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: `msg-${i}` });
    }
    // The oldest ids fell out of the 64-entry ring and are deliverable again;
    // the newest are still remembered.
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-0' }))
      .toEqual({ allow: true });
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-199' }))
      .toMatchObject({ dropped: true });
  });
});

describe('prompt guard — authority', () => {
  it('refuses a reviewer prompting a worker pane, with a reason', () => {
    const verdict = checkPrompt({
      targetId: 'w1:p2',
      targetTokens: WORKER_TOKENS,
      sender: REVIEWER,
      messageId: 'msg-r',
    });
    expect(verdict).toMatchObject({ refused: true });
    expect('reason' in verdict && verdict.reason).toContain('agent-min-1039-review');
    expect('reason' in verdict && verdict.reason).toContain('worker');
  });

  it('accepts the issue’s work pane', () => {
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'm' }))
      .toEqual({ allow: true });
  });

  it('accepts an operator conversation', () => {
    expect(isOperatorConversation(OPERATOR)).toBe(true);
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: OPERATOR, messageId: 'm' }))
      .toEqual({ allow: true });
  });

  it('refuses another issue’s work pane', () => {
    expect(
      checkPrompt({
        targetId: 'w1:p2',
        targetTokens: WORKER_TOKENS,
        sender: { id: 'agent-pan-3917', issue: 'PAN-3917', role: 'work' },
        messageId: 'm',
      }),
    ).toMatchObject({ refused: true });
  });

  it('leaves non-worker targets open', () => {
    expect(
      checkPrompt({
        targetId: 'w1:p1',
        targetTokens: { ...WORKER_TOKENS, role: 'work' },
        sender: REVIEWER,
        messageId: 'm',
      }),
    ).toEqual({ allow: true });
  });

  it('does not spend a ring slot on a refused message', () => {
    checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: REVIEWER, messageId: 'msg-x' });
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender: FOREMAN, messageId: 'msg-x' }))
      .toEqual({ allow: true });
  });
});

describe('senderFromEnv', () => {
  it('reads OVERDECK_AGENT_ID and the target lookup', () => {
    const sender = senderFromEnv(
      { OVERDECK_AGENT_ID: 'agent-min-1039' } as NodeJS.ProcessEnv,
      () => ({ issue: 'MIN-1039', role: 'work' }),
    );
    expect(sender).toMatchObject({ id: 'agent-min-1039', issue: 'MIN-1039', role: 'work' });
  });

  it('looks the SENDER up by its own id, never the target', () => {
    // Regression: passing the target's tokens as the lookup made a foreman look
    // like a `worker` to its own worker pane, and the authority check refused
    // the one sender it must always allow.
    const asked: string[] = [];
    const sender = senderFromEnv(
      { OVERDECK_AGENT_ID: 'agent-min-1039' } as NodeJS.ProcessEnv,
      (id) => { asked.push(id); return { issue: 'MIN-1039', role: 'work' }; },
    );
    expect(asked).toEqual(['agent-min-1039']);
    expect(checkPrompt({ targetId: 'w1:p2', targetTokens: WORKER_TOKENS, sender, messageId: 'f1' }))
      .toEqual({ allow: true });
  });

  it('treats a process with no agent id as an operator conversation', () => {
    const sender = senderFromEnv({} as NodeJS.ProcessEnv);
    expect(isOperatorConversation(sender)).toBe(true);
  });
});

describe('both adapters run the guard', () => {
  it('tmux: a reviewer is refused and a repeat is dropped', async () => {
    vi.resetModules();
    vi.doMock('../../../../src/lib/agents/agent-state-read.js', () => ({
      getAgentStateSync: () => ({ id: 'agent-min-1039-item', issueId: 'MIN-1039', role: 'worker', model: 'x', harness: 'claude-code' }),
    }));
    const sent: string[] = [];
    vi.doMock('../../../../src/lib/tmux.js', () => ({
      createSession: () => Effect.succeed(undefined),
      killSession: () => Effect.succeed(undefined),
      listSessions: () => Effect.succeed([]),
      sendKeys: (_session: string, text: string) => Effect.sync(() => { sent.push(text); }),
      sessionExists: () => Effect.succeed(true),
    }));
    vi.doMock('../../../../src/lib/agents/liveness.js', () => ({
      isAlive: async () => ({ alive: true, paneAlive: true }),
      isIdle: () => false,
    }));

    const { TmuxBackend } = await import('../../../../src/lib/terminal-backends/tmux.js');
    const { resetPromptGuard: reset } = await import('../../../../src/lib/terminal-backends/prompt-guard.js');
    reset();
    const backend = new TmuxBackend();
    const target = { paneId: 'agent-min-1039-item' };

    const refused = await Effect.runPromise(
      backend.prompt(target, 'do it my way', { messageId: 'r1', sender: REVIEWER }),
    );
    expect(refused).toMatchObject({ refused: true });
    expect(sent).toHaveLength(0);

    const delivered = await Effect.runPromise(
      backend.prompt(target, 'item 3 please', { messageId: 'w1', sender: FOREMAN }),
    );
    expect(delivered).toMatchObject({ delivered: true });
    const repeat = await Effect.runPromise(
      backend.prompt(target, 'item 3 please', { messageId: 'w1', sender: FOREMAN }),
    );
    expect(repeat).toMatchObject({ dropped: true });
    expect(sent).toHaveLength(1);
    vi.doUnmock('../../../../src/lib/tmux.js');
    vi.doUnmock('../../../../src/lib/agents/agent-state-read.js');
    vi.doUnmock('../../../../src/lib/agents/liveness.js');
    vi.resetModules();
  });

  it('herdr: a reviewer is refused and a repeat is dropped', async () => {
    const { HerdrBackend } = await import('../../../../src/lib/terminal-backends/herdr.js');
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const fakeApi = {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === 'agent.get') {
          return { agent: { pane_id: 'w1:p2', agent_status: 'idle', tokens: WORKER_TOKENS } };
        }
        return { agent: { pane_id: 'w1:p2', agent_status: 'working' } };
      },
    };
    resetPromptGuard();
    const backend = new HerdrBackend(fakeApi as never);
    const target = { agentName: 'agent-min-1039-item' };

    const refused = await Effect.runPromise(
      backend.prompt(target, 'do it my way', { messageId: 'r1', sender: REVIEWER }),
    );
    expect(refused).toMatchObject({ refused: true });
    expect(calls.some((call) => call.method === 'agent.prompt')).toBe(false);

    const delivered = await Effect.runPromise(
      backend.prompt(target, 'item 3 please', { messageId: 'w1', sender: FOREMAN }),
    );
    expect(delivered).toMatchObject({ delivered: true, messageId: 'w1' });
    const repeat = await Effect.runPromise(
      backend.prompt(target, 'item 3 please', { messageId: 'w1', sender: FOREMAN }),
    );
    expect(repeat).toMatchObject({ dropped: true });
    expect(calls.filter((call) => call.method === 'agent.prompt')).toHaveLength(1);
  });
});
