import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingTurn } from '@panctl/contracts';
import {
  maybeTriggerStatusRollup,
  pendingTurnFileName,
  readPendingTurns,
  setStatusRollupEnqueuer,
  writePendingTurn,
  type StatusRollupJob,
} from '../../../src/lib/memory/pending.js';
import { loadMemorySettings } from '../../../src/lib/memory/settings.js';

let tempDir: string | null = null;
let originalHome: string | undefined;
let restoreEnqueuer: (() => void) | null = null;

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

function turnForSession(sessionId: string, minute: number): PendingTurn {
  return pendingTurn({
    id: `pending-${sessionId}`,
    createdAt: `2026-05-16T20:${String(minute).padStart(2, '0')}:00.000Z`,
    identity: { ...identity, sessionId },
  });
}

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-pending-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  restoreEnqueuer?.();
  restoreEnqueuer = null;
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

  it('triggers a workspace status rollup after the configurable pending threshold is reached', async () => {
    const enqueue = vi.fn<[StatusRollupJob], void>();
    restoreEnqueuer = setStatusRollupEnqueuer(enqueue);

    await writePendingTurn(turnForSession('session-a', 1), { loadThreshold: () => 4 });
    await writePendingTurn(turnForSession('session-b', 2), { loadThreshold: () => 4 });
    await writePendingTurn(turnForSession('session-c', 3), { loadThreshold: () => 4 });
    expect(enqueue).not.toHaveBeenCalled();

    await writePendingTurn(turnForSession('session-d', 4), { loadThreshold: () => 4 });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      identity: {
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
      },
      threshold: 4,
    });
    expect(enqueue.mock.calls[0]![0].pendingTurns.map((turn) => turn.identity.sessionId)).toEqual([
      'session-a',
      'session-b',
      'session-c',
      'session-d',
    ]);
  });

  it('collapses concurrent triggers to one in-flight rollup per workspace', async () => {
    await writePendingTurn(turnForSession('session-a', 1), { loadThreshold: () => 10 });
    await writePendingTurn(turnForSession('session-b', 2), { loadThreshold: () => 10 });
    await writePendingTurn(turnForSession('session-c', 3), { loadThreshold: () => 10 });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enqueue = vi.fn<[StatusRollupJob], Promise<void>>(() => gate);

    const writes = Promise.all([
      writePendingTurn(turnForSession('session-d', 4), { loadThreshold: () => 4, enqueueStatusRollup: enqueue }),
      writePendingTurn(turnForSession('session-e', 5), { loadThreshold: () => 4, enqueueStatusRollup: enqueue }),
    ]);

    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    release();
    await writes;

    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('reads pending turns from every session in chronological filename order', async () => {
    await writePendingTurn(turnForSession('session-b', 2), { loadThreshold: () => 10 });
    await writePendingTurn(turnForSession('session-a', 1), { loadThreshold: () => 10 });

    expect((await readPendingTurns('panopticon-cli', 'PAN-1052')).map((turn) => turn.identity.sessionId)).toEqual([
      'session-a',
      'session-b',
    ]);
  });

  it('loads the rollup threshold from settings each time', async () => {
    const configPath = join(tempDir!, 'config.yaml');
    await writeFile(configPath, 'memory:\n  rollup_pending_threshold: 6\n', 'utf8');
    expect(await loadMemorySettings(configPath)).toEqual({ rollupPendingThreshold: 6 });

    await writeFile(configPath, 'memory:\n  rollup_pending_threshold: 2\n', 'utf8');
    expect(await loadMemorySettings(configPath)).toEqual({ rollupPendingThreshold: 2 });
  });

  it('uses the default threshold when memory settings are absent', async () => {
    expect(await loadMemorySettings(join(tempDir!, 'missing.yaml'))).toEqual({ rollupPendingThreshold: 4 });
    expect(await maybeTriggerStatusRollup(identity, { loadThreshold: () => 0 })).toEqual({
      status: 'below-threshold',
      pendingCount: 0,
      threshold: 4,
    });
  });
});
