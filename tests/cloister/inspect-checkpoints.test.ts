/**
 * PAN-382: Tests for inspect checkpoint system
 */

import { describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Hoist mocks to avoid TDZ
const TEST_HOME = vi.hoisted(() => {
  const { join } = require('path');
  const { tmpdir } = require('os');
  return join(tmpdir(), `pan-test-inspect-${Date.now()}`);
});

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => TEST_HOME };
});

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
  exec: vi.fn((cmd: string, opts: any, cb?: Function) => {
    // Simulate async exec by calling execSync mock
    const callback = cb || opts;
    try {
      const result = execSyncMock(cmd, typeof opts === 'object' ? opts : {});
      if (typeof callback === 'function') callback(null, { stdout: result || '', stderr: '' });
    } catch (err) {
      if (typeof callback === 'function') callback(err, { stdout: '', stderr: '' });
    }
  }),
}));

import {
  loadCheckpoints,
  getLastCheckpoint,
  saveCheckpoint,
  getDiffBase,
  getDiffStats,
  getCurrentHead,
} from '../../src/lib/cloister/inspect-checkpoints.js';

describe('inspect-checkpoints', () => {
  const projectKey = 'test-project';
  const issueId = 'MIN-796';

  beforeEach(() => {
    mkdirSync(join(TEST_HOME, '.panopticon'), { recursive: true });
    execSyncMock.mockReset();
  });

  afterEach(() => {
    try {
      rmSync(TEST_HOME, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('loadCheckpoints', () => {
    it.effect('returns null when no checkpoint file exists', () =>
      Effect.gen(function* () {
        const result = yield* loadCheckpoints(projectKey, issueId);
        expect(result).toBeNull();
      })
    );

    it.effect('loads existing checkpoints from file', () =>
      Effect.gen(function* () {
        const dir = join(TEST_HOME, '.panopticon', 'specialists', projectKey, 'inspect-agent', 'checkpoints');
        mkdirSync(dir, { recursive: true });
        const data = {
          issueId: 'MIN-796',
          checkpoints: [
            { beadId: 'myn-80', commitSha: 'abc123', passedAt: '2026-03-22T10:00:00Z' },
          ],
        };
        writeFileSync(join(dir, 'MIN-796.json'), JSON.stringify(data));

        const result = yield* loadCheckpoints(projectKey, issueId);
        expect(result).not.toBeNull();
        expect(result!.checkpoints).toHaveLength(1);
        expect(result!.checkpoints[0].beadId).toBe('myn-80');
      })
    );
  });

  describe('getLastCheckpoint', () => {
    it.effect('returns null when no checkpoints exist', () =>
      Effect.gen(function* () {
        const result = yield* getLastCheckpoint(projectKey, issueId);
        expect(result).toBeNull();
      })
    );

    it.effect('returns the last checkpoint', () =>
      Effect.gen(function* () {
        yield* saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');
        yield* saveCheckpoint(projectKey, issueId, 'myn-81', 'def456');

        const last = yield* getLastCheckpoint(projectKey, issueId);
        expect(last).not.toBeNull();
        expect(last!.beadId).toBe('myn-81');
        expect(last!.commitSha).toBe('def456');
      })
    );
  });

  describe('saveCheckpoint', () => {
    it.effect('creates checkpoint file if it does not exist', () =>
      Effect.gen(function* () {
        const checkpoint = yield* saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');

        expect(checkpoint.beadId).toBe('myn-80');
        expect(checkpoint.commitSha).toBe('abc123');
        expect(checkpoint.passedAt).toBeTruthy();

        const data = yield* loadCheckpoints(projectKey, issueId);
        expect(data!.checkpoints).toHaveLength(1);
      })
    );

    it.effect('appends to existing checkpoints', () =>
      Effect.gen(function* () {
        yield* saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');
        yield* saveCheckpoint(projectKey, issueId, 'myn-81', 'def456');
        yield* saveCheckpoint(projectKey, issueId, 'myn-82', 'ghi789');

        const data = yield* loadCheckpoints(projectKey, issueId);
        expect(data!.checkpoints).toHaveLength(3);
        expect(data!.checkpoints[2].beadId).toBe('myn-82');
      })
    );
  });

  describe('getDiffBase', () => {
    it.effect('uses merge-base when no checkpoint exists', () =>
      Effect.gen(function* () {
        execSyncMock.mockReturnValue('abc123def456\n');
        const base = yield* getDiffBase(projectKey, issueId, '/tmp/workspace');
        expect(base).toBe('abc123def456');
      })
    );

    it.effect('uses last checkpoint SHA when checkpoints exist', () =>
      Effect.gen(function* () {
        yield* saveCheckpoint(projectKey, issueId, 'myn-80', 'checkpoint-sha');
        const base = yield* getDiffBase(projectKey, issueId, '/tmp/workspace');
        expect(base).toBe('checkpoint-sha');
      })
    );

    it.effect('falls back to main when merge-base fails', () =>
      Effect.gen(function* () {
        execSyncMock.mockImplementation(() => {
          throw new Error('not a git repo');
        });
        const base = yield* getDiffBase(projectKey, issueId, '/tmp/workspace');
        expect(base).toBe('main');
      })
    );
  });

  describe('getDiffStats', () => {
    it.effect('returns diff stats from git', () =>
      Effect.gen(function* () {
        execSyncMock.mockReturnValue(' 3 files changed, 120 insertions(+), 5 deletions(-)\n');
        const stats = yield* getDiffStats('/tmp/workspace', 'abc123');
        expect(stats).toContain('3 files changed');
      })
    );

    it.effect('returns fallback message on error', () =>
      Effect.gen(function* () {
        execSyncMock.mockImplementation(() => {
          throw new Error('git error');
        });
        const stats = yield* getDiffStats('/tmp/workspace', 'abc123');
        expect(stats).toBe('Unable to compute diff stats');
      })
    );
  });

  describe('getCurrentHead', () => {
    it.effect('returns HEAD sha', () =>
      Effect.gen(function* () {
        execSyncMock.mockReturnValue('abc123def456\n');
        const head = yield* getCurrentHead('/tmp/workspace');
        expect(head).toBe('abc123def456');
      })
    );

    it.effect('returns unknown on error', () =>
      Effect.gen(function* () {
        execSyncMock.mockImplementation(() => {
          throw new Error('not a git repo');
        });
        const head = yield* getCurrentHead('/tmp/workspace');
        expect(head).toBe('unknown');
      })
    );
  });
});
