import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  conversationHarnessAlive,
  conversationSessionAlive,
  listLiveConversationSessions,
  waitForConversationSession,
  type ConversationLivenessDeps,
} from '../conversation-liveness.js';
import type { HerdrLivenessProbe } from '../../terminal-backends/herdr.js';

function herdr(probe: HerdrLivenessProbe, extra: Partial<ConversationLivenessDeps> = {}): ConversationLivenessDeps {
  return {
    backend: 'herdr',
    probeHerdr: vi.fn(async () => probe),
    sessionExists: vi.fn(async () => false),
    listSessionNames: vi.fn(async () => []),
    harnessAlive: vi.fn(async () => false),
    ...extra,
  };
}

describe('conversationSessionAlive (PAN-3921)', () => {
  it('reads a Herdr alive or indeterminate probe as alive', async () => {
    await expect(conversationSessionAlive('conv-x', herdr({ kind: 'alive', paneId: 'p', state: 'idle' }))).resolves.toBe(true);
    await expect(conversationSessionAlive('conv-x', herdr({ kind: 'indeterminate', reason: 'socket' }))).resolves.toBe(true);
  });

  it('reads a Herdr exited probe as dead', async () => {
    await expect(conversationSessionAlive('conv-x', herdr({ kind: 'exited', paneId: 'p' }))).resolves.toBe(false);
  });

  it('falls back to the legacy tmux session when Herdr reports absent', async () => {
    await expect(conversationSessionAlive('conv-x', herdr({ kind: 'absent' }))).resolves.toBe(false);
    const legacy = herdr({ kind: 'absent' }, { sessionExists: vi.fn(async () => true) });
    await expect(conversationSessionAlive('conv-x', legacy)).resolves.toBe(true);
    expect(legacy.sessionExists).toHaveBeenCalledWith('conv-x');
  });

  it('answers from tmux on a tmux host without probing Herdr when the session exists', async () => {
    const probeHerdr = vi.fn();
    const sessionExists = vi.fn(async () => true);
    await expect(conversationSessionAlive('conv-x', { backend: 'tmux', probeHerdr, sessionExists })).resolves.toBe(true);
    expect(sessionExists).toHaveBeenCalledWith('conv-x');
    expect(probeHerdr).not.toHaveBeenCalled();
  });

  it('on a tmux host, sees a conversation still running in a Herdr pane (rollback safety)', async () => {
    const tmuxHost = (probe: HerdrLivenessProbe): ConversationLivenessDeps => ({
      backend: 'tmux',
      sessionExists: async () => false,
      harnessAlive: async () => false,
      probeHerdr: async () => probe,
    });
    await expect(conversationSessionAlive('conv-x', tmuxHost({ kind: 'alive', paneId: 'p', state: 'idle' }))).resolves.toBe(true);
    await expect(conversationHarnessAlive('conv-x', tmuxHost({ kind: 'alive', paneId: 'p', state: 'idle' }))).resolves.toBe(true);
    // An unreachable Herdr is the normal state of a tmux host, not evidence of life.
    await expect(conversationSessionAlive('conv-x', tmuxHost({ kind: 'indeterminate', reason: 'no socket' }))).resolves.toBe(false);
    await expect(conversationHarnessAlive('conv-x', tmuxHost({ kind: 'exited', paneId: 'p' }))).resolves.toBe(false);
  });
});

describe('conversationHarnessAlive (PAN-3921)', () => {
  it('follows the Herdr probe, and the legacy tmux harness check when Herdr reports absent', async () => {
    await expect(conversationHarnessAlive('conv-x', herdr({ kind: 'alive', paneId: 'p', state: 'working' }))).resolves.toBe(true);
    await expect(conversationHarnessAlive('conv-x', herdr({ kind: 'exited', paneId: 'p' }))).resolves.toBe(false);
    const legacy = herdr({ kind: 'absent' }, { sessionExists: vi.fn(async () => true), harnessAlive: vi.fn(async () => true) });
    await expect(conversationHarnessAlive('conv-x', legacy)).resolves.toBe(true);
  });
});

describe('listLiveConversationSessions (PAN-3921)', () => {
  it('returns Herdr agents that have not exited plus legacy tmux sessions', async () => {
    const names = await listLiveConversationSessions({
      backend: 'herdr',
      listHerdr: async () => [
        { agentId: 'conv-a', state: 'idle' },
        { agentId: 'conv-b', state: 'exited' },
      ],
      listSessionNames: async () => ['conv-legacy'],
    });
    expect(names && [...names].sort()).toEqual(['conv-a', 'conv-legacy']);
  });

  it('returns null when Herdr does not answer, so no caller reads every conversation as dead', async () => {
    const names = await listLiveConversationSessions({
      backend: 'herdr',
      listHerdr: async () => { throw new Error('socket down'); },
      listSessionNames: async () => ['conv-legacy'],
    });
    expect(names).toBeNull();
  });

  it('returns the tmux session names on a tmux host, plus live conv-* Herdr panes when Herdr answers', async () => {
    const names = await listLiveConversationSessions({
      backend: 'tmux',
      listSessionNames: async () => ['conv-a'],
      listHerdr: async () => [
        { agentId: 'conv-b', state: 'idle' },
        { agentId: 'conv-c', state: 'exited' },
        { agentId: 'agent-pan-1', state: 'working' },
      ],
    });
    expect(names && [...names].sort()).toEqual(['conv-a', 'conv-b']);

    const withoutHerdr = await listLiveConversationSessions({
      backend: 'tmux',
      listSessionNames: async () => ['conv-a'],
      listHerdr: async () => { throw new Error('no socket'); },
    });
    expect(withoutHerdr && [...withoutHerdr]).toEqual(['conv-a']);
  });
});

describe('waitForConversationSession (PAN-3921)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the pane comes up before the deadline', async () => {
    vi.useFakeTimers();
    let alive = false;
    const deps: ConversationLivenessDeps = { backend: 'tmux', sessionExists: async () => alive, probeHerdr: async () => ({ kind: 'absent' }) };
    const waiting = waitForConversationSession('conv-x', 5_000, deps);
    await vi.advanceTimersByTimeAsync(1_000);
    alive = true;
    await vi.advanceTimersByTimeAsync(250);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('rejects after the timeout when the pane never comes up', async () => {
    vi.useFakeTimers();
    const waiting = waitForConversationSession('conv-x', 5_000, {
      backend: 'tmux',
      sessionExists: async () => false,
      probeHerdr: async () => ({ kind: 'absent' }),
    });
    const assertion = expect(waiting).rejects.toThrow('Timed out waiting for conversation session conv-x');
    await vi.advanceTimersByTimeAsync(5_250);
    await assertion;
  });
});
