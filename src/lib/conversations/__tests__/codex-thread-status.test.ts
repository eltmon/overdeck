import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyCodexTurnFailure, codexThreadStatus, readCodexLastTurn } from '../codex-thread-status.js';

const AUTH_MESSAGE = 'Error running remote compact task: Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.';

function eventMsg(timestamp: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp, type: 'event_msg', payload });
}

function userMessage(timestamp: string, text: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  });
}

describe('codex-thread-status (PAN-5633)', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'codex-thread-status-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function rollout(lines: string[], prefix = ''): Promise<string> {
    const file = join(dir, 'rollout.jsonl');
    await writeFile(file, `${prefix}${lines.join('\n')}\n`);
    return file;
  }

  it('classifies an unauthorized task_complete as an auth failure', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:33:10.000Z', { type: 'task_started', turn_id: 't1' }),
      userMessage('2026-11-23T17:33:11.000Z', 'hello'),
      eventMsg('2026-11-23T17:33:20.000Z', {
        type: 'task_complete',
        turn_id: 't1',
        last_agent_message: null,
        error: { message: AUTH_MESSAGE, codex_error_info: 'unauthorized' },
      }),
    ]);
    await expect(readCodexLastTurn(file)).resolves.toEqual({
      status: 'done',
      failure: { message: AUTH_MESSAGE, at: '2026-11-23T17:33:20.000Z', code: 'unauthorized', kind: 'auth' },
    });
  });

  it('classifies context_window_exceeded as context-window', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:44:30.000Z', { type: 'task_started', turn_id: 't2' }),
      eventMsg('2026-11-23T17:44:36.000Z', {
        type: 'task_complete',
        turn_id: 't2',
        error: { message: 'Codex ran out of room in the model\'s context window.', codex_error_info: 'context_window_exceeded' },
      }),
    ]);
    const turn = await readCodexLastTurn(file);
    expect(turn.status).toBe('done');
    expect(turn.failure?.kind).toBe('context-window');
    expect(turn.failure?.code).toBe('context_window_exceeded');
    expect(classifyCodexTurnFailure('contextWindowExceeded', '')).toBe('context-window');
  });

  it('falls back to the message text when codex_error_info is missing', async () => {
    expect(classifyCodexTurnFailure(null, 'Your refresh token was already used.')).toBe('auth');
    const file = await rollout([
      eventMsg('2026-11-23T17:33:20.000Z', {
        type: 'task_complete',
        error: { message: '  The refresh token was already used.  ' },
      }),
    ]);
    const turn = await readCodexLastTurn(file);
    expect(turn.failure).toEqual({
      message: 'The refresh token was already used.',
      at: '2026-11-23T17:33:20.000Z',
      code: null,
      kind: 'auth',
    });
  });

  it('reads an object-valued codex_error_info as its first key', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:50:00.000Z', {
        type: 'task_complete',
        error: { message: 'stream disconnected before completion', codex_error_info: { response_stream_disconnected: {} } },
      }),
    ]);
    const turn = await readCodexLastTurn(file);
    expect(turn.failure?.code).toBe('response_stream_disconnected');
    expect(turn.failure?.kind).toBe('other');
  });

  it('trims the failure message to 300 characters', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:50:00.000Z', { type: 'task_complete', error: { message: 'x'.repeat(1000) } }),
    ]);
    expect((await readCodexLastTurn(file)).failure?.message).toHaveLength(300);
  });

  it('returns no failure for a successful task_complete', async () => {
    const file = await rollout([
      eventMsg('2026-11-18T14:30:40.000Z', { type: 'task_started', turn_id: 't0' }),
      eventMsg('2026-11-18T14:30:49.000Z', { type: 'task_complete', turn_id: 't0', last_agent_message: 'done' }),
    ]);
    await expect(readCodexLastTurn(file)).resolves.toEqual({ status: 'done', failure: null });
    await expect(codexThreadStatus(file)).resolves.toBe('done');
  });

  it('returns running when task_started is newest', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:33:20.000Z', {
        type: 'task_complete',
        error: { message: AUTH_MESSAGE, codex_error_info: 'unauthorized' },
      }),
      eventMsg('2026-11-23T17:40:00.000Z', { type: 'task_started', turn_id: 't3' }),
      userMessage('2026-11-23T17:40:01.000Z', 'retry'),
    ]);
    await expect(readCodexLastTurn(file)).resolves.toEqual({ status: 'running', failure: null });
    await expect(codexThreadStatus(file)).resolves.toBe('running');
  });

  it('returns done with no failure for turn_aborted', async () => {
    const file = await rollout([
      eventMsg('2026-11-23T17:40:00.000Z', { type: 'task_started' }),
      eventMsg('2026-11-23T17:40:05.000Z', { type: 'turn_aborted', reason: 'interrupted' }),
    ]);
    await expect(readCodexLastTurn(file)).resolves.toEqual({ status: 'done', failure: null });
  });

  it('reads only the tail of a large file', async () => {
    // A failed turn older than the 128 KiB tail must not be seen; the newest turn is.
    const old = eventMsg('2026-11-20T00:00:00.000Z', {
      type: 'task_complete',
      error: { message: AUTH_MESSAGE, codex_error_info: 'unauthorized' },
    });
    const filler = `${userMessage('2026-11-20T00:00:01.000Z', 'f'.repeat(1024))}\n`.repeat(200);
    const file = await rollout([
      eventMsg('2026-11-23T17:50:00.000Z', {
        type: 'task_complete',
        error: { message: 'boom', codex_error_info: 'internal_server_error' },
      }),
    ], `${old}\n${filler}`);
    const turn = await readCodexLastTurn(file);
    expect(turn.failure).toMatchObject({ message: 'boom', kind: 'other', code: 'internal_server_error' });

    const onlyOld = join(dir, 'only-old.jsonl');
    await writeFile(onlyOld, `${old}\n${filler}`);
    await expect(readCodexLastTurn(onlyOld)).resolves.toEqual({ status: 'running', failure: null });
  });
});
