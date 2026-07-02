import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseCodexSessionMetadata, parsePiSessionMetadata } from '../../../../src/lib/conversations/harness-metadata.js';
import { scan } from '../../../../src/lib/conversations/scanner.js';
import { findDiscoveredSessions } from '../../../../src/lib/overdeck/discovered-sessions.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';

let tempHome: string | null = null;
let savedHome: string | undefined;
let homeChanged = false;
let odb: OverdeckTestDb | null = null;

afterEach(() => {
  if (odb) {
    teardownOverdeckTestDb(odb);
    odb = null;
  }
  if (homeChanged) {
    if (savedHome !== undefined) {
      process.env.HOME = savedHome;
    } else {
      delete process.env.HOME;
    }
  }
  savedHome = undefined;
  homeChanged = false;
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

describe('parsePiSessionMetadata', () => {
  it('extracts Pi v3 session metadata from messages, model changes, usage, and tool calls', async () => {
    const file = writeTempPiSession(piFixture());

    const meta = await parsePiSessionMetadata(file);

    expect(meta.sessionId).toBe('pi-session-1');
    expect(meta.cwdFromFirstMessage).toBe('/home/user/Projects/pi-app');
    expect(meta.messageCount).toBe(2);
    expect(meta.firstTs).toBe('2026-07-02T10:00:00.000Z');
    expect(meta.lastTs).toBe('2026-07-02T10:00:03.000Z');
    expect(meta.modelsUsed).toEqual(['anthropic/claude-sonnet-4-6']);
    expect(meta.primaryModel).toBe('anthropic/claude-sonnet-4-6');
    expect(meta.tokenInput).toBe(115);
    expect(meta.tokenOutput).toBe(25);
    expect(meta.toolsUsed).toEqual(['Read']);
    expect(meta.filesTouched).toEqual(['/home/user/Projects/pi-app/src/index.ts']);
  });

  it('skips malformed JSONL lines and returns metadata from valid Pi lines', async () => {
    const file = writeTempPiSession([
      sessionLine(),
      '{not-json',
      modelChangeLine(),
      assistantLine(),
    ].join('\n') + '\n');

    const meta = await parsePiSessionMetadata(file);

    expect(meta.sessionId).toBe('pi-session-1');
    expect(meta.messageCount).toBe(1);
    expect(meta.primaryModel).toBe('anthropic/claude-sonnet-4-6');
    expect(meta.tokenInput).toBe(115);
    expect(meta.tokenOutput).toBe(25);
  });

  it('scan persists parsed Pi and ohmypi metadata with the discovered harness tag', async () => {
    odb = setupOverdeckTestDb();
    savedHome = process.env.HOME;
    homeChanged = true;
    process.env.HOME = odb.home;

    const piPath = join(odb.home, '.pi', 'agent', 'sessions', '-home-user-Projects-pi-app', '20260702_pi-session-1.jsonl');
    const ompPath = join(odb.home, '.omp', 'agent', 'sessions', '-home-user-Projects-omp-app', '20260702_omp-session-1.jsonl');
    writeFile(piPath, piFixture());
    writeFile(ompPath, piFixture({ sessionId: 'omp-session-1', cwd: '/home/user/Projects/omp-app' }));

    const result = await scan({ mode: 'system', watchDirs: [] });

    expect(result.errors).toBe(0);
    expect(result.inserted).toBe(2);
    const sessions = findDiscoveredSessions();
    const pi = sessions.find((session) => session.jsonlPath === piPath);
    const omp = sessions.find((session) => session.jsonlPath === ompPath);
    expect(pi).toMatchObject({
      harness: 'pi',
      sessionId: 'pi-session-1',
      workspacePath: '/home/user/Projects/pi-app',
      messageCount: 2,
      primaryModel: 'anthropic/claude-sonnet-4-6',
      tokenInput: 115,
      tokenOutput: 25,
    });
    expect(pi?.toolsUsed).toContain('Read');
    expect(omp).toMatchObject({
      harness: 'ohmypi',
      sessionId: 'omp-session-1',
      workspacePath: '/home/user/Projects/omp-app',
      messageCount: 2,
    });
  });
});

describe('parseCodexSessionMetadata', () => {
  it('extracts nested-payload Codex rollout metadata from session_meta, token_count, and function_call records', async () => {
    const file = writeTempSession('rollout-2026-07-02T00-00-00-000Z-codex-thread-1.jsonl', codexFixture());

    const meta = await parseCodexSessionMetadata(file);

    expect(meta.sessionId).toBe('codex-thread-1');
    expect(meta.cwdFromFirstMessage).toBe('/home/user/Projects/codex-app');
    expect(meta.messageCount).toBe(3);
    expect(meta.firstTs).toBe('2026-07-02T11:00:00.000Z');
    expect(meta.lastTs).toBe('2026-07-02T11:00:06.000Z');
    expect(meta.modelsUsed).toEqual(['gpt-5.5']);
    expect(meta.primaryModel).toBe('gpt-5.5');
    expect(meta.tokenInput).toBe(9000);
    expect(meta.tokenOutput).toBe(500);
    expect(meta.toolsUsed).toEqual(['exec_command']);
    expect(meta.filesTouched).toEqual([]);
  });

  it('skips malformed JSONL lines and returns metadata from valid Codex lines', async () => {
    const file = writeTempSession('rollout-2026-07-02T00-00-00-000Z-codex-thread-1.jsonl', [
      codexSessionMetaLine(),
      '{not-json',
      codexTurnContextLine(),
      codexAgentMessageLine('Working on it.', '2026-07-02T11:00:03.000Z'),
      codexTokenCountLine(5000, 200, '2026-07-02T11:00:04.000Z'),
    ].join('\n') + '\n');

    const meta = await parseCodexSessionMetadata(file);

    expect(meta.sessionId).toBe('codex-thread-1');
    expect(meta.messageCount).toBe(1);
    expect(meta.primaryModel).toBe('gpt-5.5');
    expect(meta.tokenInput).toBe(5000);
    expect(meta.tokenOutput).toBe(200);
  });

  it('scan persists parsed Codex metadata with the discovered harness tag', async () => {
    odb = setupOverdeckTestDb();
    savedHome = process.env.HOME;
    homeChanged = true;
    process.env.HOME = odb.home;

    const codexPath = join(
      odb.home,
      '.codex',
      'sessions',
      '2026',
      '07',
      '02',
      'rollout-2026-07-02T00-00-00-000Z-codex-thread-1.jsonl',
    );
    writeFile(codexPath, codexFixture());

    const result = await scan({ mode: 'system', watchDirs: [] });

    expect(result.errors).toBe(0);
    expect(result.inserted).toBe(1);
    const session = findDiscoveredSessions().find((s) => s.jsonlPath === codexPath);
    expect(session).toMatchObject({
      harness: 'codex',
      sessionId: 'codex-thread-1',
      workspacePath: '/home/user/Projects/codex-app',
      messageCount: 3,
      primaryModel: 'gpt-5.5',
      tokenInput: 9000,
      tokenOutput: 500,
    });
    expect(session?.toolsUsed).toContain('exec_command');
  });
});

function writeTempPiSession(content: string): string {
  return writeTempSession('session.jsonl', content);
}

function writeTempSession(name: string, content: string): string {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-2224-pi-'));
  const file = join(tempHome, name);
  writeFile(file, content);
  return file;
}

function writeFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function piFixture(overrides: { sessionId?: string; cwd?: string } = {}): string {
  return [
    sessionLine(overrides),
    modelChangeLine(),
    userLine(),
    assistantLine(),
  ].join('\n') + '\n';
}

function sessionLine(overrides: { sessionId?: string; cwd?: string } = {}): string {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id: overrides.sessionId ?? 'pi-session-1',
    timestamp: '2026-07-02T10:00:00.000Z',
    cwd: overrides.cwd ?? '/home/user/Projects/pi-app',
  });
}

function modelChangeLine(): string {
  return JSON.stringify({
    type: 'model_change',
    id: 'model-1',
    timestamp: '2026-07-02T10:00:01.000Z',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
  });
}

function userLine(): string {
  return JSON.stringify({
    type: 'message',
    id: 'msg-user',
    parentId: null,
    timestamp: '2026-07-02T10:00:02.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Read the file' }],
    },
  });
}

function assistantLine(): string {
  return JSON.stringify({
    type: 'message',
    id: 'msg-assistant',
    parentId: 'msg-user',
    timestamp: '2026-07-02T10:00:03.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will inspect it.' },
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'Read',
          arguments: { file_path: '/home/user/Projects/pi-app/src/index.ts' },
        },
      ],
      usage: {
        input: 100,
        output: 25,
        cacheRead: 10,
        cacheWrite: 5,
      },
    },
  });
}

function codexFixture(): string {
  return [
    codexSessionMetaLine(),
    codexTurnContextLine(),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-07-02T11:00:02.000Z',
      payload: { type: 'user_message', message: 'fix the bug' },
    }),
    codexAgentMessageLine('Checking the branch first.', '2026-07-02T11:00:03.000Z'),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-07-02T11:00:03.500Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: 'git status', workdir: '/repo' }),
        call_id: 'call_1',
      },
    }),
    codexTokenCountLine(5000, 200, '2026-07-02T11:00:04.000Z'),
    codexAgentMessageLine('Done.', '2026-07-02T11:00:05.000Z'),
    codexTokenCountLine(9000, 500, '2026-07-02T11:00:06.000Z'),
  ].join('\n') + '\n';
}

function codexSessionMetaLine(): string {
  return JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-07-02T11:00:00.000Z',
    payload: {
      id: 'codex-thread-1',
      cwd: '/home/user/Projects/codex-app',
      model_provider: 'openai',
    },
  });
}

function codexTurnContextLine(): string {
  return JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-07-02T11:00:01.000Z',
    payload: { type: 'turn_context', turn_id: 'turn-1', model: 'gpt-5.5' },
  });
}

function codexAgentMessageLine(message: string, timestamp: string): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: { type: 'agent_message', message },
  });
}

function codexTokenCountLine(inputTokens: number, outputTokens: number, timestamp: string): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: inputTokens,
          cached_input_tokens: 1000,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      },
    },
  });
}
