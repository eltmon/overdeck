import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sendKeysDedup } from '../tmux-dedup.js';

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

/**
 * Real throwaway tmux server — the dedup record is a tmux session option set
 * atomically with the paste by the tmux SERVER, so only a live server can
 * prove the check/paste/mark sequence. (PAN-2997)
 */
describe.skipIf(!hasTmux)('sendKeysDedup', () => {
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

  it('pastes and marks on first delivery, then suppresses a replay of the same key', async () => {
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('delivered');
    const afterFirst = capturePane();
    expect(afterFirst).toContain('wake up agent');

    const second = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(second).toBe('deduplicated');
    expect(capturePane()).toBe(afterFirst);
  });

  it('delivers identical content under a different key', async () => {
    await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    const third = await sendKeysDedup(session, 'wake up agent', 'test-key-2');
    expect(third).toBe('delivered');
    expect(capturePane().match(/wake up agent/g)).toHaveLength(2);
  });

  it('rejects keys that are unsafe for tmux option names', async () => {
    await expect(sendKeysDedup(session, 'content', 'bad key with spaces')).rejects.toThrow(/dedupKey/);
  });
});
