/**
 * PAN-4292: tmux `sendKeys` submit mode. A steer submits with Claude Code's
 * send-now chord (C-x C-s) instead of Enter (C-m), on the first submit and on
 * the resend chaser. The default submit is unchanged.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[][],
  /** What capture-pane returns: the pasted text until the composer submits. */
  paneText: '',
  /** When true, the pasted text never leaves the pane (forces the resend chaser). */
  stickyPaste: false,
  home: '',
}));

// sendKeys writes its paste buffer to a temp file. Real file I/O would resolve
// outside the fake clock and strand the verify loop, so every await here is a
// microtask.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(async () => {}), unlink: vi.fn(async () => {}), mkdir: vi.fn(async () => undefined) };
});
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = vi.fn((_cmd: string, args: string[], _opts: unknown, cb: (err: unknown, out: unknown) => void) => {
    h.calls.push(args);
    let stdout = '';
    if (args.includes('capture-pane')) stdout = h.paneText;
    if (args.includes('paste-buffer')) h.paneText = '❯ steer the running turn now please';
    if (args[0] === 'send-keys' && !h.stickyPaste) h.paneText = '❯ ';
    cb(null, { stdout, stderr: '' });
  });
  return { ...actual, execFile };
});
vi.mock('../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => ({ config: { tmux: { configMode: 'inherit-user' } } }),
  };
});
vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return { ...actual, getOverdeckHome: () => h.home, getCanonicalOverdeckHome: () => h.home };
});

import { sendKeys } from '../tmux.js';
import { STEER_HERDR_KEYS, STEER_PTY_BYTES, STEER_TMUX_KEYS, tmuxSubmitKeys } from '../terminal-backends/steer-keys.js';

const MESSAGE = 'steer the running turn now please';

function sendKeysCalls(): string[][] {
  return h.calls.filter((args) => args[0] === 'send-keys');
}

async function run(options?: Parameters<typeof sendKeys>[3]): Promise<void> {
  const done = Effect.runPromise(sendKeys('agent-steer', MESSAGE, 'test', options));
  await vi.advanceTimersByTimeAsync(10_000);
  await done;
}

describe('tmuxSubmitKeys (PAN-4292)', () => {
  it('maps enter to C-m and steer to the send-now chord', () => {
    expect(tmuxSubmitKeys()).toEqual(['C-m']);
    expect(tmuxSubmitKeys('enter')).toEqual(['C-m']);
    expect(tmuxSubmitKeys('steer')).toEqual(['C-x', 'C-s']);
  });

  it('spells the same chord for every backend', () => {
    expect(STEER_TMUX_KEYS).toEqual(['C-x', 'C-s']);
    expect(STEER_HERDR_KEYS).toEqual(['ctrl+x', 'ctrl+s']);
    expect(STEER_PTY_BYTES).toBe('\x18\x13');
  });
});

describe('sendKeys submit mode (PAN-4292)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.calls = [];
    h.paneText = '❯ ';
    h.stickyPaste = false;
    h.home = mkdtempSync(join(tmpdir(), 'pan-4292-sendkeys-'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits with C-m by default', async () => {
    await run();
    expect(sendKeysCalls()).toEqual([['send-keys', '-t', 'agent-steer', 'C-m']]);
  });

  it('submits with C-x C-s when steering', async () => {
    await run({ submit: 'steer' });
    expect(sendKeysCalls()).toEqual([['send-keys', '-t', 'agent-steer', 'C-x', 'C-s']]);
  });

  it('resends the send-now chord, never Enter, when the steer text stays visible', async () => {
    h.stickyPaste = true;
    await run({ submit: 'steer' });
    expect(sendKeysCalls()).toEqual([
      ['send-keys', '-t', 'agent-steer', 'C-x', 'C-s'],
      ['send-keys', '-t', 'agent-steer', 'C-x', 'C-s'],
    ]);
  });

  it('resends C-m by default when the text stays visible', async () => {
    h.stickyPaste = true;
    await run();
    expect(sendKeysCalls()).toEqual([
      ['send-keys', '-t', 'agent-steer', 'C-m'],
      ['send-keys', '-t', 'agent-steer', 'C-m'],
    ]);
  });
});
