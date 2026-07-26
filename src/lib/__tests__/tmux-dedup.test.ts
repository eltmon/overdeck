import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { completeKeyedSubmit, sendKeysDedup } from '../tmux-dedup.js';

const socket = `dedup-test-${process.pid}`;
const session = 'agent-dedup';

const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function capturePane(): string {
  return execFileSync('tmux', ['-L', socket, 'capture-pane', '-t', session, '-p'], { encoding: 'utf-8' }).toString();
}

function showOption(name: string): string {
  try {
    return execFileSync('tmux', ['-L', socket, 'show-option', '-qv', '-t', session, name], { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.match(new RegExp(needle, 'g'))?.length ?? 0;
}

/** Type literal text into the pane WITHOUT submitting it (a busy composer). */
function typeWithoutSubmit(text: string): void {
  execFileSync('tmux', ['-L', socket, 'send-keys', '-t', session, '-l', text]);
}

/**
 * Real throwaway tmux server — the dedup record is a pair of tmux session
 * options and the submission is a single server-executed `if-shell` command
 * list, so only a live server can prove the claim/Enter ordering and the
 * crash boundaries around it. (PAN-2997)
 */
describe.skipIf(!hasTmux)('sendKeysDedup two-phase protocol', () => {
  beforeEach(() => {
    process.env.OVERDECK_TMUX_SOCKET_NAME = socket;
    execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', session, '-x', '120', '-y', '30', 'cat']);
  });

  afterEach(() => {
    try {
      execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // Server already gone.
    }
    delete process.env.OVERDECK_TMUX_SOCKET_NAME;
  });

  it('pastes and claims on first delivery, submits once, then suppresses a replay of the same key', async () => {
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');
    expect(capturePane()).toContain('wake up agent');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).not.toBe('');

    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).toBe('');
    const afterSubmit = capturePane();

    const second = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(second).toBe('deduplicated');
    expect(capturePane()).toBe(afterSubmit);
  });

  it('completes a crashed attempt from the pending marker WITHOUT pasting a second copy', async () => {
    // First attempt pastes, then "crashes" before the submit.
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(1);

    // Recovery replay: the pending marker routes to submit-completion, not a
    // second paste.
    const replay = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(replay).toBe('submit-pending');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(1);

    await completeKeyedSubmit(session, 'test-key-1');
    // cat echoes the submitted line once: exactly one input copy plus one
    // cat output copy — no second paste ever happened.
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');

    const settled = capturePane();
    const afterRecovery = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(afterRecovery).toBe('deduplicated');
    expect(capturePane()).toBe(settled);
  });

  it('runs the submission exactly once for TWO CONCURRENT completers (cycle 8)', async () => {
    // Call A pastes and claims; call B observes the pending claim.
    const a = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(a).toBe('pasted');
    const b = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(b).toBe('submit-pending');

    // Both callers complete — the server-side condition admits exactly one.
    await Promise.all([
      completeKeyedSubmit(session, 'test-key-1'),
      completeKeyedSubmit(session, 'test-key-1'),
    ]);

    // The wake was submitted exactly once (input echo + one cat output).
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).toBe('');
  });

  it('sends no second Enter when a replayed submit races a completed transaction into a busy composer (cycle 8)', async () => {
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');
    await completeKeyedSubmit(session, 'test-key-1');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);

    // The agent reached a new prompt and the operator is typing again.
    typeWithoutSubmit('operator follow-up');

    // A misguided late completer (e.g. a recovery pass that crashed after the
    // server claimed the submit but before it read the response) must not
    // send another Enter into the busy composer.
    await completeKeyedSubmit(session, 'test-key-1');

    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
    expect(occurrences(capturePane(), 'operator follow-up')).toBe(1);
  });

  it('delivers identical content under a different key', async () => {
    await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    const third = await sendKeysDedup(session, 'wake up agent', 'test-key-2');
    expect(third).toBe('pasted');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
  });

  it('rejects keys that are unsafe for tmux option names', async () => {
    await expect(sendKeysDedup(session, 'content', 'bad key with spaces')).rejects.toThrow(/dedupKey/);
    await expect(completeKeyedSubmit(session, 'bad key with spaces')).rejects.toThrow(/dedupKey/);
  });
});
