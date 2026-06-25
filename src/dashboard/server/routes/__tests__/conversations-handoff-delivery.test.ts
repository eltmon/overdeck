/**
 * PAN-1624 regression coverage for handoff/fork brief delivery.
 *
 *  - confirmForkPromptAccepted: the hook-driven landing check that decides
 *    whether a delivered brief was accepted, dropped (retry), or unconfirmable
 *    (don't retry — avoid double-submit).
 *  - isInsideGitWorkTree: the up-front cwd guard so a handoff in a non-git
 *    directory fails loudly instead of spawning a session that immediately dies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const execFileAsync = promisify(execFile);

// Control the hook-driven runtime mirror that confirmForkPromptAccepted reads.
const runtimeState = vi.hoisted(() => ({ value: null as null | { state: string } }));
const paneSnapshots = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock('../../../../lib/agents.js', async () => {
  const actual = await vi.importActual('../../../../lib/agents.js');
  return {
    ...(actual as object),
    deliverAgentMessage: vi.fn().mockResolvedValue(undefined),
    getAgentRuntimeStateSync: vi.fn(() => runtimeState.value),
  };
});
vi.mock('../../../../lib/tmux.js', async () => {
  const actual = await vi.importActual('../../../../lib/tmux.js');
  return {
    ...(actual as object),
    capturePane: vi.fn(() => Effect.succeed(paneSnapshots.values.shift() ?? '')),
  };
});

import { confirmForkPromptAccepted, isInsideGitWorkTree, waitForPiTuiReady } from '../conversations.js';

describe('confirmForkPromptAccepted (PAN-1624)', () => {
  beforeEach(() => {
    runtimeState.value = null;
  });

  it('returns "accepted" immediately once the agent goes active (brief landed + submitted)', async () => {
    runtimeState.value = { state: 'active' };
    await expect(confirmForkPromptAccepted('conv-x', 8000)).resolves.toBe('accepted');
  });

  it('treats waiting-on-human as accepted (a prompt was submitted)', async () => {
    runtimeState.value = { state: 'waiting-on-human' };
    await expect(confirmForkPromptAccepted('conv-x', 8000)).resolves.toBe('accepted');
  });

  describe('timeout outcomes', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "still-idle" when the mirror is live but the agent never leaves idle (dropped paste → caller retries)', async () => {
      runtimeState.value = { state: 'idle' };
      const p = confirmForkPromptAccepted('conv-x', 8000);
      await vi.advanceTimersByTimeAsync(9000);
      await expect(p).resolves.toBe('still-idle');
    });

    it('returns "unknown" when the mirror never reports a usable state (caller must NOT retry — avoids double submit)', async () => {
      runtimeState.value = null;
      const p = confirmForkPromptAccepted('conv-x', 8000);
      await vi.advanceTimersByTimeAsync(9000);
      await expect(p).resolves.toBe('unknown');
    });
  });
});

describe('waitForPiTuiReady (PAN-1793)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    paneSnapshots.values = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the Pi input prompt instead of treating splash text as ready', async () => {
    paneSnapshots.values = [
      'oh-my-pi starting...\nloading extensions\n',
      'Model kimi-k2.6\n0.0% context used\n❯ ',
    ];

    const ready = waitForPiTuiReady('conv-pi', 1000);
    await vi.advanceTimersByTimeAsync(250);

    await expect(ready).resolves.toBe(true);
  });

  it('times out when Pi renders text but never reaches the input prompt', async () => {
    paneSnapshots.values = Array.from({ length: 8 }, () => 'oh-my-pi starting...\nloading extensions\n');

    const ready = waitForPiTuiReady('conv-pi', 1000);
    await vi.advanceTimersByTimeAsync(1250);

    await expect(ready).resolves.toBe(false);
  });
});

describe('isInsideGitWorkTree (PAN-1624)', () => {
  it('returns true inside a git work tree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-git-'));
    try {
      await execFileAsync('git', ['init'], { cwd: dir });
      await expect(isInsideGitWorkTree(dir)).resolves.toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false for a non-git directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-nogit-'));
    try {
      await expect(isInsideGitWorkTree(dir)).resolves.toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns false for a nonexistent directory', async () => {
    await expect(isInsideGitWorkTree('/nonexistent/pan-1624-xyz')).resolves.toBe(false);
  });
});
