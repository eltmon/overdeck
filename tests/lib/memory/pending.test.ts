import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PendingTurn } from '@panctl/contracts';
import { pendingTurnFileName, writePendingTurn } from '../../../src/lib/memory/pending.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session/with spaces',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

function pendingTurn(overrides: Partial<PendingTurn> = {}): PendingTurn {
  return {
    id: 'pending-1',
    createdAt: '2026-05-16T20:31:00.123Z',
    identity,
    trigger: 'stop-hook',
    transcriptPath: '/tmp/session.jsonl',
    fromOffset: 10,
    toOffset: 100,
    lastFullLineOffset: 100,
    eventsConsumed: 3,
    compressedText: 'U: do work\nA: done',
    ...overrides,
  };
}

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-pending-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('pending turn writer', () => {
  it('builds chronological filenames from millis and sanitized session id', () => {
    expect(pendingTurnFileName(pendingTurn())).toBe('1778963460123_session_with_spaces.json');
  });

  it('writes pending turn payloads atomically into the issue pending directory', async () => {
    const turn = pendingTurn();
    const result = await writePendingTurn(turn);

    expect(result).toEqual({
      fileName: '1778963460123_session_with_spaces.json',
      path: join(tempDir!, 'memory/panopticon-cli/PAN-1052/pending/1778963460123_session_with_spaces.json'),
    });

    const raw = await readFile(result.path, 'utf8');
    expect(JSON.parse(raw)).toEqual(turn);

    const files = await readdir(join(tempDir!, 'memory/panopticon-cli/PAN-1052/pending'));
    expect(files).toEqual(['1778963460123_session_with_spaces.json']);
  });
});
