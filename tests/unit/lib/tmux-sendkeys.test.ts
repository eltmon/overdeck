import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import { sendKeysAsync, waitForClaudePrompt } from '../../../src/lib/tmux.js';

describe('sendKeysAsync', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a distinct buffer per multiline segment', async () => {
    await sendKeysAsync('agent-pan-711', 'first line\nsecond line');

    const setBufferCalls = execFileMock.mock.calls.filter(([, args]) => Array.isArray(args) && args.includes('set-buffer'));
    expect(setBufferCalls).toHaveLength(2);

    const bufferIds = setBufferCalls.map(([, args]) => args[args.indexOf('-b') + 1]);
    expect(bufferIds[0]).not.toBe(bufferIds[1]);

    const sendKeysCalls = execFileMock.mock.calls.filter(([, args]) => Array.isArray(args) && args.includes('send-keys'));
    expect(sendKeysCalls.map(([, args]) => args.at(-1))).toEqual(['S-Enter', 'C-m']);
    expect(sendKeysCalls.every(([, args]) => args[args.indexOf('-t') + 1] === 'agent-pan-711')).toBe(true);
  });

  it('uses a unique buffer name for single-line sends', async () => {
    await sendKeysAsync('agent-pan-711', 'single line');

    const setBufferCall = execFileMock.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('set-buffer'));
    expect(setBufferCall).toBeDefined();

    const pasteBufferCall = execFileMock.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('paste-buffer'));
    expect(pasteBufferCall).toBeDefined();

    const bufferId = setBufferCall?.[1]?.[setBufferCall[1].indexOf('-b') + 1];
    expect(bufferId).toMatch(/^pan-sendkeys-\d+-\d+-[a-z0-9]+-single$/);
    expect(pasteBufferCall?.[1]?.[pasteBufferCall[1].indexOf('-b') + 1]).toBe(bufferId);
    expect(execFileMock.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('delete-buffer'))).toBe(false);
  });
});

describe('waitForClaudePrompt', () => {
  it('detects the prompt anywhere in the captured pane output', async () => {
    execFileMock.mockReset();
    execFileMock.mockImplementation((_file: string, args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
      if (Array.isArray(args) && args.includes('capture-pane')) {
        callback(null, { stdout: 'Startup banner\nMore output\n❯ continue', stderr: '' });
        return;
      }
      callback(null, { stdout: '', stderr: '' });
    });

    await expect(waitForClaudePrompt('agent-pan-711', 10)).resolves.toBe(true);
  });
});
