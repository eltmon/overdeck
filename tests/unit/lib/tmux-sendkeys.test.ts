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

import { sendKeysAsync } from '../../../src/lib/tmux.js';

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

  it('uses a distinct temp file per multiline segment', async () => {
    await sendKeysAsync('agent-pan-711', 'first line\nsecond line');

    const loadBufferCalls = execFileMock.mock.calls.filter(([, args]) => Array.isArray(args) && args.includes('load-buffer'));
    expect(loadBufferCalls).toHaveLength(2);

    const loadedFiles = loadBufferCalls.map(([, args]) => args[args.length - 1]);
    expect(loadedFiles[0]).not.toBe(loadedFiles[1]);

    const sendKeysCalls = execFileMock.mock.calls.filter(([, args]) => Array.isArray(args) && args.includes('send-keys'));
    expect(sendKeysCalls.map(([, args]) => args.at(-1))).toEqual(['S-Enter', 'C-m']);
  });

  it('uses a unique buffer name for single-line sends', async () => {
    await sendKeysAsync('agent-pan-711', 'single line');

    const loadBufferCall = execFileMock.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('load-buffer'));
    expect(loadBufferCall).toBeDefined();

    const pasteBufferCall = execFileMock.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('paste-buffer'));
    const deleteBufferCall = execFileMock.mock.calls.find(([, args]) => Array.isArray(args) && args.includes('delete-buffer'));

    const bufferId = loadBufferCall?.[1]?.[loadBufferCall[1].indexOf('-b') + 1];
    expect(bufferId).toMatch(/^pan-sendkeys-\d+-\d+$/);
    expect(pasteBufferCall?.[1]?.[pasteBufferCall[1].indexOf('-b') + 1]).toBe(bufferId);
    expect(deleteBufferCall?.[1]?.[deleteBufferCall[1].indexOf('-b') + 1]).toBe(bufferId);
  });
});
