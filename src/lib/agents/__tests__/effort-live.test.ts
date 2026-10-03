import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyClaudeLiveEffort,
  LIVE_EFFORT_CONFIRM_TIMEOUT_MS,
  readTranscriptRecordsSince,
  type ClaudeLiveEffortDeps,
  type ClaudeLiveEffortTarget,
} from '../effort-live.js';

const LOW_CONFIRMATION = {
  type: 'user',
  message: {
    role: 'user',
    content:
      '<local-command-stdout>Set effort level to low (saved as your default for new sessions): Quick, straightforward implementation</local-command-stdout>',
  },
};
const BOGUS_REJECTION = {
  type: 'user',
  message: {
    role: 'user',
    content:
      '<local-command-stdout>Invalid argument: bogus. Valid options are: low, medium, high, xhigh, max, auto, ultracode [on|off]</local-command-stdout>',
  },
};
const COMMAND_RECORD = {
  type: 'user',
  message: { role: 'user', content: '<command-name>/effort</command-name>\n            <command-args>low</command-args>' },
};

const TARGET: ClaudeLiveEffortTarget = {
  paneId: 'conv-effort',
  workspace: '/tmp/ws',
  sessionId: 'session-1',
  deliveryMethod: 'tmux',
  caller: 'conversation-effort',
};

function makeDeps(overrides: Partial<ClaudeLiveEffortDeps> = {}) {
  const deps = {
    waitForIdle: vi.fn(async () => true),
    runtimeState: vi.fn(() => null),
    readPane: vi.fn(async () => '❯ '),
    ensureMain: vi.fn(async () => ({ ok: true as const, check: 'no-selector' as const })),
    snapshot: vi.fn(async () => ({ sessionFile: '/tmp/ws/session-1.jsonl', userRecordCount: 0, readOffset: 100, fileSize: 120 })),
    deliver: vi.fn(async () => ({ ok: true, path: 'tmux' as const })),
    readSince: vi.fn(async (_file: string, offset: number) => ({ records: [] as unknown[], nextOffset: offset })),
    ...overrides,
  };
  return deps;
}

describe('applyClaudeLiveEffort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('confirms when the low confirmation record appears on the second poll', async () => {
    const readSince = vi
      .fn()
      .mockResolvedValueOnce({ records: [COMMAND_RECORD], nextOffset: 200 })
      .mockResolvedValueOnce({ records: [LOW_CONFIRMATION], nextOffset: 400 });
    const deps = makeDeps({ readSince });

    const pending = applyClaudeLiveEffort(TARGET, 'low', deps);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: true, effort: 'low' });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledWith('conv-effort', '/effort low', 'conversation-effort', 'tmux');
    expect(readSince).toHaveBeenNthCalledWith(1, '/tmp/ws/session-1.jsonl', 100);
    expect(readSince).toHaveBeenNthCalledWith(2, '/tmp/ws/session-1.jsonl', 200);
  });

  it('reports not-confirmed after the confirmation window', async () => {
    const deps = makeDeps();

    const pending = applyClaudeLiveEffort(TARGET, 'low', deps);
    await vi.advanceTimersByTimeAsync(LIVE_EFFORT_CONFIRM_TIMEOUT_MS + 500);

    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'not-confirmed' });
    expect(deps.readSince.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports effort-rejected with Claude Code’s message', async () => {
    const deps = makeDeps({ readSince: vi.fn(async () => ({ records: [BOGUS_REJECTION], nextOffset: 300 })) });

    const pending = applyClaudeLiveEffort(TARGET, 'low', deps);
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toEqual({
      ok: false,
      code: 'effort-rejected',
      error: 'Invalid argument: bogus. Valid options are: low, medium, high, xhigh, max, auto, ultracode [on|off]',
    });
  });

  it('refuses a session the mirror says is mid-turn and delivers nothing', async () => {
    const deps = makeDeps({
      waitForIdle: vi.fn(async () => false),
      runtimeState: vi.fn(() => ({ state: 'active' }) as never),
    });

    const result = await applyClaudeLiveEffort(TARGET, 'low', deps);

    expect(result).toMatchObject({ ok: false, code: 'busy' });
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.ensureMain).not.toHaveBeenCalled();
  });

  it('treats unknown runtime state as not busy and delivers', async () => {
    const deps = makeDeps({
      waitForIdle: vi.fn(async () => false),
      runtimeState: vi.fn(() => null),
      readSince: vi.fn(async () => ({ records: [LOW_CONFIRMATION], nextOffset: 300 })),
    });

    const pending = applyClaudeLiveEffort(TARGET, 'low', deps);
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toEqual({ ok: true, effort: 'low' });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it('refuses when a permission prompt is on the pane', async () => {
    const promptScreen = readFileSync(
      new URL('../__fixtures__/claude-code-2.1.280/permission-bash.txt', import.meta.url),
      'utf8',
    );
    const deps = makeDeps({ readPane: vi.fn(async () => promptScreen) });

    const result = await applyClaudeLiveEffort(TARGET, 'low', deps);

    expect(result).toMatchObject({ ok: false, code: 'permission-pending' });
    expect(deps.ensureMain).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('treats an unreadable pane as no prompt', async () => {
    const deps = makeDeps({
      readPane: vi.fn(async () => null),
      readSince: vi.fn(async () => ({ records: [LOW_CONFIRMATION], nextOffset: 300 })),
    });

    const pending = applyClaudeLiveEffort(TARGET, 'low', deps);
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toEqual({ ok: true, effort: 'low' });
  });

  it('refuses when the input target is not the main agent', async () => {
    const deps = makeDeps({
      ensureMain: vi.fn(async () => ({ ok: false as const, reason: 'x', inputTarget: 'unknown' as const })),
    });

    const result = await applyClaudeLiveEffort(TARGET, 'low', deps);

    expect(result).toEqual({ ok: false, code: 'input-target-not-main', error: 'x' });
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('reports not-delivered when the terminal refuses and never reads the transcript', async () => {
    const deps = makeDeps({ deliver: vi.fn(async () => ({ ok: false, path: 'tmux' as const, failure: 'refused' })) });

    const result = await applyClaudeLiveEffort(TARGET, 'low', deps);

    expect(result).toEqual({ ok: false, code: 'not-delivered', error: 'refused' });
    expect(deps.readSince).not.toHaveBeenCalled();
  });

  it('maps a thrown delivery error to not-delivered', async () => {
    const deps = makeDeps({ deliver: vi.fn(async () => { throw new Error('pane gone'); }) });

    const result = await applyClaudeLiveEffort(TARGET, 'low', deps);

    expect(result).toEqual({ ok: false, code: 'not-delivered', error: 'pane gone' });
  });
});

describe('readTranscriptRecordsSince', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'effort-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads complete lines and leaves a trailing partial line for the next call', async () => {
    const file = join(dir, 'session.jsonl');
    const first = `${JSON.stringify({ type: 'system' })}\n`;
    await writeFile(file, `${first}${JSON.stringify(LOW_CONFIRMATION)}\n{"type":"us`);

    const read = await readTranscriptRecordsSince(file, first.length);
    expect(read.records).toEqual([LOW_CONFIRMATION]);

    await appendFile(file, 'er"}\n');
    const next = await readTranscriptRecordsSince(file, read.nextOffset);
    expect(next.records).toEqual([{ type: 'user' }]);
  });

  it('reads a missing file as empty', async () => {
    await expect(readTranscriptRecordsSince(join(dir, 'missing.jsonl'), 42)).resolves.toEqual({ records: [], nextOffset: 42 });
  });
});
