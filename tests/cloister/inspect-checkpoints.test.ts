import { Effect } from 'effect';
/**
 * PAN-382: Tests for inspect checkpoint system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    it('returns null when no checkpoint file exists', () => {
      expect(loadCheckpoints(projectKey, issueId)).toBeNull();
    });

    it('loads existing checkpoints from file', () => {
      const dir = join(TEST_HOME, '.panopticon', 'specialists', projectKey, 'inspect-agent', 'checkpoints');
      mkdirSync(dir, { recursive: true });
      const data = {
        issueId: 'MIN-796',
        checkpoints: [
          { beadId: 'myn-80', commitSha: 'abc123', passedAt: '2026-03-22T10:00:00Z' },
        ],
      };
      writeFileSync(join(dir, 'MIN-796.json'), JSON.stringify(data));

      const result = loadCheckpoints(projectKey, issueId);
      expect(result).not.toBeNull();
      expect(result!.checkpoints).toHaveLength(1);
      expect(result!.checkpoints[0].beadId).toBe('myn-80');
    });
  });

  describe('getLastCheckpoint', () => {
    it('returns null when no checkpoints exist', () => {
      expect(getLastCheckpoint(projectKey, issueId)).toBeNull();
    });

    it('returns the last checkpoint', () => {
      // Save two checkpoints
      saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');
      saveCheckpoint(projectKey, issueId, 'myn-81', 'def456');

      const last = getLastCheckpoint(projectKey, issueId);
      expect(last).not.toBeNull();
      expect(last!.beadId).toBe('myn-81');
      expect(last!.commitSha).toBe('def456');
    });
  });

  describe('saveCheckpoint', () => {
    it('creates checkpoint file if it does not exist', () => {
      const checkpoint = saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');

      expect(checkpoint.beadId).toBe('myn-80');
      expect(checkpoint.commitSha).toBe('abc123');
      expect(checkpoint.passedAt).toBeTruthy();

      const data = loadCheckpoints(projectKey, issueId);
      expect(data!.checkpoints).toHaveLength(1);
    });

    it('appends to existing checkpoints', () => {
      saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');
      saveCheckpoint(projectKey, issueId, 'myn-81', 'def456');
      saveCheckpoint(projectKey, issueId, 'myn-82', 'ghi789');

      const data = loadCheckpoints(projectKey, issueId);
      expect(data!.checkpoints).toHaveLength(3);
      expect(data!.checkpoints[2].beadId).toBe('myn-82');
    });
  });

  describe('getDiffBase', () => {
    it('uses merge-base when no checkpoint exists', async () => {
      execSyncMock.mockReturnValue('abc123def456\n');

      const base = await Effect.runPromise(getDiffBase(projectKey, issueId, '/tmp/workspace'));
      expect(base).toBe('abc123def456');
    });

    it('uses last checkpoint SHA when checkpoints exist', async () => {
      saveCheckpoint(projectKey, issueId, 'myn-80', 'checkpoint-sha');

      const base = await Effect.runPromise(getDiffBase(projectKey, issueId, '/tmp/workspace'));
      expect(base).toBe('checkpoint-sha');
    });

    it('falls back to main when merge-base fails', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      const base = await Effect.runPromise(getDiffBase(projectKey, issueId, '/tmp/workspace'));
      expect(base).toBe('main');
    });
  });

  describe('getDiffStats', () => {
    it('returns diff stats from git', async () => {
      execSyncMock.mockReturnValue(' 3 files changed, 120 insertions(+), 5 deletions(-)\n');

      const stats = await Effect.runPromise(getDiffStats('/tmp/workspace', 'abc123'));
      expect(stats).toContain('3 files changed');
    });

    it('returns fallback message on error', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('git error');
      });

      const stats = await Effect.runPromise(getDiffStats('/tmp/workspace', 'abc123'));
      expect(stats).toBe('Unable to compute diff stats');
    });
  });

  describe('getCurrentHead', () => {
    it('returns HEAD sha', async () => {
      execSyncMock.mockReturnValue('abc123def456\n');

      const head = await Effect.runPromise(getCurrentHead('/tmp/workspace'));
      expect(head).toBe('abc123def456');
    });

    it('returns unknown on error', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      const head = await Effect.runPromise(getCurrentHead('/tmp/workspace'));
      expect(head).toBe('unknown');
    });
  });
});
