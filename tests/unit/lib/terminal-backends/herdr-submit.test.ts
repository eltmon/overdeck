import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { pasteAndSubmitHerdrPane, pasteSettleMs } from '../../../../src/lib/terminal-backends/herdr-submit.js';

/**
 * PAN-4492. `pasteAndSubmitHerdrPane` replaces Herdr's `agent.prompt` for
 * Claude Code panes: paste, wait for the composer to show it, settle, press
 * the submit keystroke, then watch the composer to know whether the Enter
 * landed.
 */

interface Call { method: string; params: Record<string, unknown> }

function fakeApi(handler: (call: Call) => unknown, log: Call[] = []) {
  return {
    log,
    api: {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        const result = handler({ method, params });
        if (result instanceof Error) throw result;
        return result ?? {};
      },
    },
  };
}

/** Returns each screen in order, then stays on the last one. */
function sequentialScreens(...screens: string[]) {
  let index = 0;
  return () => {
    const screen = screens[Math.min(index, screens.length - 1)]!;
    index += 1;
    return screen;
  };
}

const RULE = '──────────────────────────────────────────────────────────';
const emptyComposer = [RULE, '❯ ', RULE].join('\n');
const composerWith = (text: string) => [RULE, `❯ ${text}`, RULE].join('\n');

const PERMISSION_MENU = [
  'Do you want to allow this Bash command?',
  '',
  '❯ 1. Yes',
  "  2. Yes, and don't ask again",
  '  3. No',
  '',
  'Esc to cancel · Tab to amend',
].join('\n');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(15_000);
  return pending;
}

describe('pasteAndSubmitHerdrPane', () => {
  it('confirms a submit on the first try', async () => {
    const text = 'send this message';
    const nextScreen = sequentialScreens(emptyComposer, composerWith(text), emptyComposer);
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: nextScreen() };
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', text));

    expect(outcome).toBe('submitted');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
    ]);
  });

  it('resubmits once when the message is still in the composer after Enter', async () => {
    const text = 'send this message';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: composerWith(text) };
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', text));

    expect(outcome).toBe('resubmitted');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resubmitting once (PAN-4492)'));
    warn.mockRestore();
  });

  it('holds when the agent is blocked at the decision point', async () => {
    const text = 'send this message';
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: composerWith(text) };
      if (method === 'agent.get') return { agent: { agent_status: 'blocked' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', text));

    expect(outcome).toBe('held');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
    ]);
  });

  it('holds when a permission menu appears on the same screen as the composer', async () => {
    const text = 'run the deploy script';
    const screen = [RULE, `❯ ${text}`, RULE, PERMISSION_MENU].join('\n');
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: screen };
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', text));

    expect(outcome).toBe('held');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
    ]);
  });

  it('resubmits a steer with the chord, never Enter', async () => {
    const text = 'change course';
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: composerWith(text) };
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', text, 'steer'));

    expect(outcome).toBe('resubmitted');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['ctrl+x', 'ctrl+s'] } },
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['ctrl+x', 'ctrl+s'] } },
    ]);
  });

  it('is unconfirmed when the composer can never be located', async () => {
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: '' };
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', 'send this message'));

    expect(outcome).toBe('unconfirmed');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([
      { method: 'pane.send_keys', params: { pane_id: 'w1:p2', keys: ['enter'] } },
    ]);
  });

  it('never presses a key when the paste is never visible and the agent is blocked', async () => {
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'pane.read') return { text: emptyComposer };
      if (method === 'agent.get') return { agent: { agent_status: 'blocked' } };
      return {};
    });

    const outcome = await settle(pasteAndSubmitHerdrPane(api, 'w1:p2', 'send this message'));

    expect(outcome).toBe('blocked');
    expect(log.filter((c) => c.method === 'pane.send_keys')).toEqual([]);
  });

  it('resolves, never rejects, when every pane.read throws after the paste was sent', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'pane.read') return new Error('socket closed');
      if (method === 'agent.get') return { agent: { agent_status: 'idle' } };
      return {};
    });

    await expect(settle(pasteAndSubmitHerdrPane(api, 'w1:p2', 'send this message')))
      .resolves.toBe('unconfirmed');
  });

  it('computes the tmux settle formula', () => {
    expect(pasteSettleMs('x')).toBe(600);
    expect(pasteSettleMs(Array.from({ length: 200 }, () => 'x'.repeat(25)).join('\n'))).toBe(3000);
    expect(pasteSettleMs(Array.from({ length: 5 }, () => 'x'.repeat(1024)).join('\n'))).toBe(600);
  });
});
