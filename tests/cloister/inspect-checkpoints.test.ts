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

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => TEST_HOME };
});

import {
  loadCheckpoints,
  getLastCheckpoint,
  saveCheckpoint,
} from '../../src/lib/cloister/inspect-checkpoints.js';

describe('inspect-checkpoints', () => {
  const projectKey = 'test-project';
  const issueId = 'MIN-796';

  beforeEach(() => {
    mkdirSync(join(TEST_HOME, '.overdeck'), { recursive: true });
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
      const dir = join(TEST_HOME, '.overdeck', 'specialists', projectKey, 'inspect-agent', 'checkpoints');
      mkdirSync(dir, { recursive: true });
      const data = {
        issueId: 'MIN-796',
        checkpoints: [
          { itemId: 'myn-80', commitSha: 'abc123', passedAt: '2026-03-22T10:00:00Z' },
        ],
      };
      writeFileSync(join(dir, 'MIN-796.json'), JSON.stringify(data));

      const result = loadCheckpoints(projectKey, issueId);
      expect(result).not.toBeNull();
      expect(result!.checkpoints).toHaveLength(1);
      expect(result!.checkpoints[0].itemId).toBe('myn-80');
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
      expect(last!.itemId).toBe('myn-81');
      expect(last!.commitSha).toBe('def456');
    });
  });

  describe('saveCheckpoint', () => {
    it('creates checkpoint file if it does not exist', () => {
      const checkpoint = saveCheckpoint(projectKey, issueId, 'myn-80', 'abc123');

      expect(checkpoint.itemId).toBe('myn-80');
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
      expect(data!.checkpoints[2].itemId).toBe('myn-82');
    });
  });
});
