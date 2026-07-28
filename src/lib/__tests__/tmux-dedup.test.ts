import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { completeKeyedSubmit, KeyedMarkerVerificationError, KeyedSubmitBlockedMenuError, KeyedSubmitTargetDeadError, sendKeysDedup } from '../tmux-dedup.js';

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

function showPaneDead(): string {
  return execFileSync('tmux', ['-L', socket, 'display-message', '-p', '-t', session, '#{pane_dead}'], { encoding: 'utf-8' }).trim();
}

function readPaneTargetReal(name: string): Promise<{ pid: string; dead: boolean }> {
  const out = execFileSync('tmux', ['-L', socket, 'display-message', '-p', '-t', name, '#{pane_pid} #{pane_dead}'], { encoding: 'utf-8' }).trim();
  const [pid = '', dead = ''] = out.split(/\s+/);
  return Promise.resolve({ pid, dead: dead === '1' });
}

function occurrences(haystack: string, needle: string): number {
  return haystack.match(new RegExp(needle, 'g'))?.length ?? 0;
}

/** Type literal text into the pane WITHOUT submitting it (a busy composer). */
function typeWithoutSubmit(text: string): void {
  execFileSync('tmux', ['-L', socket, 'send-keys', '-t', session, '-l', text]);
}

const RESUME_GATE_MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

/**
 * Real throwaway tmux server — the dedup record is a pair of tmux session
 * options and the submission is a single server-executed `if-shell` command
 * list, so only a live server can prove the claim/Enter ordering and the
 * crash boundaries around it. (PAN-2997)
 */
describe.skipIf(!hasTmux)('sendKeysDedup two-phase protocol', () => {
  beforeEach(() => {
    process.env.OVERDECK_TMUX_SOCKET_NAME = socket;
    // Clean up any leftover server/socket file from the previous test on
    // this (process-constant) socket name — a stale socket makes new-session
    // fail with "server exited unexpectedly".
    try {
      execFileSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // No server was running.
    }
    try {
      rmSync(join(tmpdir(), `tmux-${process.getuid?.() ?? 1000}`, socket), { force: true });
    } catch {
      // No socket file.
    }
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

  it('re-pastes after a menu-aborted submit clears without replacing the pane', async () => {
    const payload = 'menu-blocked delivery';
    const paneBefore = await readPaneTargetReal(session);
    expect(await sendKeysDedup(session, payload, 'menu-key')).toBe('pasted');
    const pendingBefore = showOption('@overdeck-dedup-pending-menu-key');
    expect(pendingBefore).not.toBe('');

    vi.useFakeTimers();
    try {
      const completion = completeKeyedSubmit(session, 'menu-key', {
        readPaneText: () => Promise.resolve(RESUME_GATE_MENU),
      });
      const rejection = expect(completion).rejects.toThrow(KeyedSubmitBlockedMenuError);
      await vi.advanceTimersByTimeAsync(300);
      await rejection;
    } finally {
      vi.useRealTimers();
    }

    expect(showOption('@overdeck-dedup-pending-menu-key')).toBe(pendingBefore);
    expect(showOption('@overdeck-dedup-target-menu-key')).toBe(paneBefore.pid);
    expect(showOption('@overdeck-dedup-menu-key')).toBe('');

    // Model the harness consuming the menu without accepting the earlier paste:
    // clear the terminal input line while keeping the same pane process alive.
    execFileSync('tmux', ['-L', socket, 'send-keys', '-t', session, 'C-u']);
    expect((await readPaneTargetReal(session)).pid).toBe(paneBefore.pid);

    // Fault injection: the first recovery cannot execute its atomic re-paste.
    // The stale matching target remains, but the next retry still cannot reuse
    // it because payload presence must be proven before returning submit-pending.
    await expect(sendKeysDedup(session, payload, 'menu-key', 'test', {
      readPaneText: () => Promise.resolve('clear composer'),
      runTmuxCommand: () => Promise.reject(new Error('tmux command unavailable')),
    })).rejects.toThrow(KeyedMarkerVerificationError);
    expect(showOption('@overdeck-dedup-pending-menu-key')).toBe(pendingBefore);
    expect(showOption('@overdeck-dedup-target-menu-key')).toBe(paneBefore.pid);
    expect(showOption('@overdeck-dedup-menu-key')).toBe('');

    const retry = await sendKeysDedup(session, payload, 'menu-key', 'test', {
      readPaneText: () => Promise.resolve('clear composer'),
    });
    expect(retry).toBe('pasted');
    expect(showOption('@overdeck-dedup-target-menu-key')).toBe(paneBefore.pid);

    vi.useFakeTimers();
    try {
      const completion = completeKeyedSubmit(session, 'menu-key', {
        readPaneText: () => Promise.resolve('busy composer'),
      });
      await vi.advanceTimersByTimeAsync(300);
      await completion;
    } finally {
      vi.useRealTimers();
    }

    expect(showOption('@overdeck-dedup-menu-key')).toBe('1');
    expect(showOption('@overdeck-dedup-pending-menu-key')).toBe('');
  });

  it('submits normal composer content when pane capture is busy or unavailable', async () => {
    expect(await sendKeysDedup(session, 'busy composer delivery', 'busy-key')).toBe('pasted');
    await completeKeyedSubmit(session, 'busy-key', {
      readPaneText: () => Promise.resolve('busy composer delivery'),
    });
    expect(showOption('@overdeck-dedup-busy-key')).toBe('1');

    expect(await sendKeysDedup(session, 'capture failure delivery', 'capture-failure-key')).toBe('pasted');
    await completeKeyedSubmit(session, 'capture-failure-key', {
      readPaneText: () => Promise.reject(new Error('capture unavailable')),
    });
    expect(showOption('@overdeck-dedup-capture-failure-key')).toBe('1');
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

  it('refuses to claim the key when the pane dies after the paste — no terminal, no Enter, pending preserved (cycle 9)', async () => {
    // remain-on-exit keeps the session (and its option markers) alive as a
    // corpse after the pane process exits.
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, 'remain-on-exit', 'on']);
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');
    const pendingBefore = showOption('@overdeck-dedup-pending-test-key-1');
    expect(pendingBefore).not.toBe('');

    // The harness exits during the settle window: C-c kills the cat.
    execFileSync('tmux', ['-L', socket, 'send-keys', '-t', session, 'C-c']);
    const deadline = Date.now() + 3_000;
    while (showPaneDead() !== '1' && Date.now() < deadline) {
      execFileSync('sleep', ['0.05']);
    }
    expect(showPaneDead()).toBe('1');

    // The submit must NOT flip the key terminal and must NOT send Enter.
    await expect(completeKeyedSubmit(session, 'test-key-1')).rejects.toThrow(KeyedSubmitTargetDeadError);
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).toBe(pendingBefore);

    // Recovery after the agent "resumes" (pane respawned = a REPLACEMENT
    // pane): the recorded paste target no longer matches, so the protocol
    // re-pastes the REAL content instead of completing with a blank Enter
    // (cycle 13). The marker protocol's job here is to prove the key was
    // never falsely claimed and the content reaches the replacement.
    execFileSync('tmux', ['-L', socket, 'respawn-pane', '-k', '-t', session, 'cat']);
    const replay = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(replay).toBe('pasted');
    expect(capturePane()).toContain('wake up agent');
    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    // Exactly one content submission reached the replacement pane.
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
  });

  it('rolls the key back when the pane dies AROUND the Enter — no false terminal, recovery pastes real content (cycle 10)', async () => {
    // Replace cat with a shell that exits as soon as it consumes the
    // submitted line: the if-shell's condition sees a live pane, the Enter
    // lands, and the harness dies in the same breath — the exact
    // shell-to-branch handoff window.
    execFileSync('tmux', ['-L', socket, 'respawn-pane', '-k', '-t', session, 'sh']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, 'remain-on-exit', 'on']);
    const first = await sendKeysDedup(session, 'exit', 'test-key-1');
    expect(first).toBe('pasted');

    await expect(completeKeyedSubmit(session, 'test-key-1')).rejects.toThrow(KeyedSubmitTargetDeadError);
    // The terminal marker was rolled back and the pending claim restored —
    // the key was NOT claimed even though send-keys reported success.
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).not.toBe('');

    // Recovery after resume recreates the session (resumeAgent kills the
    // zombie): fresh markers, and the keyed delivery performs a REAL content
    // submission into the live session.
    execFileSync('tmux', ['-L', socket, 'kill-session', '-t', session]);
    execFileSync('tmux', ['-L', socket, 'new-session', '-d', '-s', session, '-x', '120', '-y', '30', 'cat']);
    const replay = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(replay).toBe('pasted');
    await completeKeyedSubmit(session, 'test-key-1');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2); // input echo + cat output
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
  });

  it('repairs a poisoned false-terminal before honoring anything (cycle 11/12)', async () => {
    // A prior post-submit check proved this terminal marker FALSE but could
    // not verify its rollback: terminal sits there next to the poison
    // breadcrumb.
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-poison-test-key-1', '1']);

    const phase = await sendKeysDedup(session, 'wake up agent', 'test-key-1');

    // NEVER 'deduplicated' from a false terminal: the repair clears terminal
    // and restores a pending claim. With no recorded paste target (the seeded
    // markers predate it), the content is unverifiable — so the protocol
    // RE-PASTES the real content and records the current pane as target.
    expect(phase).toBe('pasted');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).not.toBe('');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-target-test-key-1')).not.toBe('');
    expect(capturePane()).toContain('wake up agent');

    // The completion delivers for real, and the breadcrumb lifecycle
    // closes: a later replay dedups on the VERIFIED terminal.
    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
    expect(await sendKeysDedup(session, 'wake up agent', 'test-key-1')).toBe('deduplicated');
  });

  it('a FAILED poison read aborts as a RECOVERABLE marker error without honoring the terminal marker (cycle 12/15)', async () => {
    // A false terminal and its breadcrumb both exist; the poison read fails.
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-poison-test-key-1', '1']);

    await expect(
      sendKeysDedup(session, 'wake up agent', 'test-key-1', 'test', {
        readMarkerStrict: () => Promise.reject(new Error('transient poison-read failure')),
      }),
    ).rejects.toThrow(KeyedMarkerVerificationError);

    // Nothing was honored, repaired, or pasted — and the call did NOT return
    // 'deduplicated' from the false terminal.
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('1');
    expect(occurrences(capturePane(), 'wake up agent')).toBe(0);

    // Recovery with a healthy read repairs and RE-PASTES the real content
    // (the seeded markers carry no recorded target).
    const phase = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(phase).toBe('pasted');
    expect(capturePane()).toContain('wake up agent');
    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
  });

  it('a FAILED poison clear after verified delivery is loud — no success with a stale breadcrumb (cycle 12)', async () => {
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');

    // The delivery verifies live, but the breadcrumb-clear verification reads
    // a stale poison — the call must NOT report success, and the failure is a
    // RECOVERABLE marker error so the wake outbox stays pending.
    await expect(
      completeKeyedSubmit(session, 'test-key-1', {
        readMarkerStrict: (name: string, option: string) => {
          if (option === '@overdeck-dedup-poison-test-key-1') {
            return Promise.resolve('1');
          }
          return Promise.resolve(showOption(option));
        },
      }),
    ).rejects.toThrow(KeyedMarkerVerificationError);

    // The terminal is legitimately set and the REAL breadcrumb was cleared —
    // only the verification read lied — so a healthy recovery dedups on the
    // verified terminal instead of invalidating it.
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
    expect(await sendKeysDedup(session, 'wake up agent', 'test-key-1')).toBe('deduplicated');
  });

  it('fails CLOSED when the pre-submit target read fails — the Enter lands but the claim rolls back (cycle 11)', async () => {
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');

    // Transient pre-target read failure: the pane's identity is unprovable,
    // so even though the Enter lands on the live pane the key must NOT stay
    // terminal (the pane could have been a contentless replacement).
    let reads = 0;
    await expect(
      completeKeyedSubmit(session, 'test-key-1', {
        readPaneTarget: (name: string) => {
          reads += 1;
          // The production helper converts a failed read into an unprovable
          // target rather than rejecting — mirror that contract.
          if (reads === 1) return Promise.resolve({ pid: '', dead: true });
          return readPaneTargetReal(name);
        },
      }),
    ).rejects.toThrow(KeyedSubmitTargetDeadError);
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-pending-test-key-1')).not.toBe('');
    // The rollback was verified, so the poison breadcrumb was lifted.
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');

    // Recovery completes the preserved claim.
    const replay = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(replay).toBe('submit-pending');
    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
  });

  it('crash recovery re-delivers real content to a REPLACED pane exactly once (cycle 13)', async () => {
    // Paste into pane A; its pid is recorded as the target atomically.
    const first = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(first).toBe('pasted');
    // Simulate the provisional crash state: the server-owned submit wrote
    // poison+terminal and the dashboard died before any post-submit read.
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-poison-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-u', '-t', session, '@overdeck-dedup-pending-test-key-1']);
    // Pane A is replaced (respawned harness) while the session options survive.
    execFileSync('tmux', ['-L', socket, 'respawn-pane', '-k', '-t', session, 'cat']);

    // Recovery: the breadcrumb forces repair, the recorded target no longer
    // matches, so the REAL content is re-pasted into the replacement —
    // never 'deduplicated', never a blank-Enter completion.
    const replay = await sendKeysDedup(session, 'wake up agent', 'test-key-1');
    expect(replay).toBe('pasted');
    expect(capturePane()).toContain('wake up agent');

    await completeKeyedSubmit(session, 'test-key-1');
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('1');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
    // Exactly one content submission reached the replacement pane.
    expect(occurrences(capturePane(), 'wake up agent')).toBe(2);
  });

  it('a rejected REPAIR verification read aborts with the breadcrumb authoritative (cycle 13)', async () => {
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-poison-test-key-1', '1']);

    await expect(
      sendKeysDedup(session, 'wake up agent', 'test-key-1', 'test', {
        readMarkerStrict: (name: string, option: string) => (
          option === '@overdeck-dedup-test-key-1'
            ? Promise.reject(new Error('transient verify-read failure'))
            : Promise.resolve(showOption(option))
        ),
      }),
    ).rejects.toThrow(KeyedMarkerVerificationError);
    // The failed read was NOT converted to empty state: the breadcrumb stays
    // authoritative for the next recovery attempt.
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('1');
  });

  it('a rejected ROLLBACK verification read aborts with the breadcrumb authoritative (cycle 13)', async () => {
    // Pane exits upon consuming the submitted line — targetLost rollback path.
    execFileSync('tmux', ['-L', socket, 'respawn-pane', '-k', '-t', session, 'sh']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, 'remain-on-exit', 'on']);
    const first = await sendKeysDedup(session, 'exit', 'test-key-1');
    expect(first).toBe('pasted');

    await expect(
      completeKeyedSubmit(session, 'test-key-1', {
        readMarkerStrict: (name: string, option: string) => (
          option === '@overdeck-dedup-test-key-1'
            ? Promise.reject(new Error('transient verify-read failure'))
            : Promise.resolve(showOption(option))
        ),
      }),
    ).rejects.toThrow(KeyedMarkerVerificationError);
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('1');
  });

  it('a failed post-clear verification during REPAIR aborts as a RECOVERABLE marker error (cycle 14)', async () => {
    // Repair reaches the breadcrumb clear with nothing delivered yet; the
    // post-clear verification keeps reading a stale poison.
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-test-key-1', '1']);
    execFileSync('tmux', ['-L', socket, 'set-option', '-t', session, '@overdeck-dedup-poison-test-key-1', '1']);

    await expect(
      sendKeysDedup(session, 'wake up agent', 'test-key-1', 'test', {
        readMarkerStrict: (name: string, option: string) => {
          if (option === '@overdeck-dedup-poison-test-key-1') {
            // The initial strict read sees the real breadcrumb; the post-clear
            // verification read reports it as surviving.
            return Promise.resolve(showOption(option) === '' ? '1' : showOption(option));
          }
          return Promise.resolve(showOption(option));
        },
      }),
    ).rejects.toThrow(KeyedMarkerVerificationError);
    // The rollback already ran (recoverable state), and the breadcrumb stays
    // authoritative for the next attempt.
    expect(showOption('@overdeck-dedup-test-key-1')).toBe('');
    expect(showOption('@overdeck-dedup-poison-test-key-1')).toBe('');
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
