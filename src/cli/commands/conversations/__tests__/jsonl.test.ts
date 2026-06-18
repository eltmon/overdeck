/**
 * Regression tests for `pan conversations jsonl` (PAN-1712).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `jsonl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function seedConversation(opts: { cwd?: string; claudeSessionId?: string | null } = {}) {
  const { createConversation } = await import('../../../../lib/database/conversations-db.js');
  const claudeSessionId = Object.prototype.hasOwnProperty.call(opts, 'claudeSessionId')
    ? (opts.claudeSessionId ?? undefined)
    : 'jsonl-session';
  return createConversation({
    name: `jsonl-test-${Math.random().toString(36).slice(2)}`,
    tmuxSession: `jsonl-tmux-${Math.random().toString(36).slice(2)}`,
    cwd: opts.cwd ?? '/tmp/jsonl-workspace',
    claudeSessionId,
    harness: 'claude-code',
  });
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));
  vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg ?? '')));
  return { logs, errors };
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
}

function writeTranscript(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ type: 'system' }) + '\n', 'utf-8');
}

describe('jsonlAction', () => {
  it('prints the derived JSONL path and exits 0 when the transcript exists', async () => {
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const cwd = '/tmp/jsonl-ok-workspace';
    const sessionId = 'jsonl-ok-session';
    const expectedPath = sessionFilePath(cwd, sessionId);
    writeTranscript(expectedPath);
    const conv = await seedConversation({ cwd, claudeSessionId: sessionId });
    const { jsonlAction } = await import('../jsonl.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await jsonlAction(String(conv.id), {});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([expectedPath]);
    expect(errors).toEqual([]);
  });

  it('reports expired and exits 1 in plain mode when no transcript exists', async () => {
    const conv = await seedConversation({ cwd: '/tmp/jsonl-expired-workspace', claudeSessionId: 'jsonl-expired-session' });
    const { jsonlAction } = await import('../jsonl.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(jsonlAction(String(conv.id), {})).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logs).toEqual([]);
    expect(errors.join('\n')).toContain('not present on disk');
    expect(errors.join('\n')).toContain('Expected path:');
  });

  it('reports unknown and exits 1 in plain mode when no claude_session_id is recorded', async () => {
    const conv = await seedConversation({ claudeSessionId: null });
    const { jsonlAction } = await import('../jsonl.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(jsonlAction(String(conv.id), {})).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logs).toEqual([]);
    expect(errors.join('\n')).toContain('no claude_session_id recorded');
  });

  it('prints JSON and exits 0 for ok, expired, and unknown statuses', async () => {
    const { sessionFilePath } = await import('../../../../lib/paths.js');
    const ok = await seedConversation({ cwd: '/tmp/jsonl-json-ok', claudeSessionId: 'jsonl-json-ok-session' });
    writeTranscript(sessionFilePath(ok.cwd, ok.claudeSessionId!));
    const expired = await seedConversation({ cwd: '/tmp/jsonl-json-expired', claudeSessionId: 'jsonl-json-expired-session' });
    const unknown = await seedConversation({ cwd: '/tmp/jsonl-json-unknown', claudeSessionId: null });
    const { jsonlAction } = await import('../jsonl.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await jsonlAction(String(ok.id), { json: true });
    await jsonlAction(String(expired.id), { json: true });
    await jsonlAction(String(unknown.id), { json: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    const payloads = logs.map((entry) => JSON.parse(entry));
    expect(payloads.map((payload) => payload.status)).toEqual(['ok', 'expired', 'unknown']);
    expect(payloads[0]).toMatchObject({ conversationId: ok.id, claudeSessionId: ok.claudeSessionId, cwd: ok.cwd });
    expect(payloads[0].path).toBe(sessionFilePath(ok.cwd, ok.claudeSessionId!));
    expect(payloads[1]).toMatchObject({ conversationId: expired.id, claudeSessionId: expired.claudeSessionId, cwd: expired.cwd });
    expect(payloads[1].path).toBe(sessionFilePath(expired.cwd, expired.claudeSessionId!));
    expect(payloads[2]).toMatchObject({ conversationId: unknown.id, claudeSessionId: null, cwd: unknown.cwd, path: null });
  });

  it('exits 1 for non-numeric ids and not-found conversations in plain and JSON modes', async () => {
    const { getDatabase } = await import('../../../../lib/database/index.js');
    getDatabase();
    const { jsonlAction } = await import('../jsonl.js');
    const { logs, errors } = captureConsole();
    const exitSpy = mockExit();

    await expect(jsonlAction('notanumber', {})).rejects.toThrow('exit 1');
    await expect(jsonlAction('9999', {})).rejects.toThrow('exit 1');
    await expect(jsonlAction('9999', { json: true })).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledTimes(3);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 1);
    expect(exitSpy).toHaveBeenNthCalledWith(2, 1);
    expect(exitSpy).toHaveBeenNthCalledWith(3, 1);
    expect(logs).toEqual([]);
    expect(errors.join('\n')).toContain('Invalid conversation ID: notanumber');
    expect(errors.join('\n')).toContain('Conversation 9999 not found');
  });
});

describe('registerConversationsCommands', () => {
  it('registers jsonl with transcript alias and documents conversation ids', async () => {
    const { registerConversationsCommands } = await import('../index.js');
    const program = new Command();
    registerConversationsCommands(program);

    const conversations = program.commands.find((command) => command.name() === 'conversations');
    const jsonl = conversations?.commands.find((command) => command.name() === 'jsonl');

    expect(jsonl).toBeDefined();
    expect(jsonl?.aliases()).toContain('transcript');
    expect(jsonl?.description()).toContain('/conv/<N>');
    expect(jsonl?.options.some((option) => option.long === '--json')).toBe(true);
  });
});
