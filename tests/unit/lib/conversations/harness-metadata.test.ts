import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { parsePiSessionMetadata } from '../../../../src/lib/conversations/harness-metadata.js';
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

function writeTempPiSession(content: string): string {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-2224-pi-'));
  const file = join(tempHome, 'session.jsonl');
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
