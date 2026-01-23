/**
 * Tests for session-rotation.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SESSION_ROTATION_THRESHOLD,
  DEFAULT_MEMORY_TIERS,
  needsSessionRotation,
  buildMergeAgentMemory,
  rotateSpecialistSession,
  checkAndRotateIfNeeded,
} from '../../src/lib/cloister/session-rotation.js';

// Mock dependencies
vi.mock('../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: vi.fn(),
}));

vi.mock('../../src/lib/agents.js', () => ({
  getAgentState: vi.fn(),
}));

vi.mock('../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn((name: string) => `specialist-${name}`),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

import { getRuntimeForAgent } from '../../src/lib/runtimes/index.js';
import { getAgentState } from '../../src/lib/agents.js';
import { execSync } from 'child_process';

const mockGetRuntimeForAgent = vi.mocked(getRuntimeForAgent);
const mockGetAgentState = vi.mocked(getAgentState);
const mockExecSync = vi.mocked(execSync);

describe('session-rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('SESSION_ROTATION_THRESHOLD', () => {
    it('should be set to 100k tokens', () => {
      expect(SESSION_ROTATION_THRESHOLD).toBe(100_000);
    });
  });

  describe('DEFAULT_MEMORY_TIERS', () => {
    it('should have correct tier sizes', () => {
      expect(DEFAULT_MEMORY_TIERS.recent_summary).toBe(100);
      expect(DEFAULT_MEMORY_TIERS.recent_detailed).toBe(50);
      expect(DEFAULT_MEMORY_TIERS.recent_full).toBe(20);
    });

    it('should have tiered memory with summary >= detailed >= full', () => {
      expect(DEFAULT_MEMORY_TIERS.recent_summary).toBeGreaterThanOrEqual(
        DEFAULT_MEMORY_TIERS.recent_detailed
      );
      expect(DEFAULT_MEMORY_TIERS.recent_detailed).toBeGreaterThanOrEqual(
        DEFAULT_MEMORY_TIERS.recent_full
      );
    });
  });

  describe('needsSessionRotation', () => {
    it('should return false when no runtime found', () => {
      mockGetRuntimeForAgent.mockReturnValue(null);
      expect(needsSessionRotation('agent-1')).toBe(false);
    });

    it('should return false when no token usage available', () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => null,
      } as any);
      expect(needsSessionRotation('agent-1')).toBe(false);
    });

    it('should return false when under threshold', () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => ({ inputTokens: 40000, outputTokens: 40000 }),
      } as any);
      expect(needsSessionRotation('agent-1')).toBe(false);
    });

    it('should return true when at threshold', () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => ({ inputTokens: 50000, outputTokens: 50000 }),
      } as any);
      expect(needsSessionRotation('agent-1')).toBe(true);
    });

    it('should return true when over threshold', () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => ({ inputTokens: 80000, outputTokens: 50000 }),
      } as any);
      expect(needsSessionRotation('agent-1')).toBe(true);
    });
  });

  describe('buildMergeAgentMemory', () => {
    it('should return fallback message on git error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repo');
      });

      const memory = buildMergeAgentMemory('/tmp/test');
      expect(memory).toBe('No merge history available.\n');
    });

    it('should build memory with merge commits', () => {
      // Mock git log returning merge commits
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log --merges')) {
          return 'abc123|Merge feature/foo|Author Name|2026-01-20|HEAD -> main\ndef456|Merge feature/bar|Author Name|2026-01-19|';
        }
        if (cmd.includes('git show --name-only')) {
          return 'src/file1.ts\nsrc/file2.ts';
        }
        if (cmd.includes('git show') && cmd.includes('--stat')) {
          return ' src/file1.ts | 10 ++++\n src/file2.ts | 5 ---\n 2 files changed, 10 insertions, 5 deletions';
        }
        return '';
      });

      const memory = buildMergeAgentMemory('/tmp/test', {
        recent_summary: 10,
        recent_detailed: 5,
        recent_full: 2,
      });

      expect(memory).toContain('# Merge-Agent Session Memory');
      expect(memory).toContain('abc123');
      expect(memory).toContain('Merge feature/foo');
      expect(memory).toContain('Files changed');
    });

    it('should handle empty merge history', () => {
      mockExecSync.mockReturnValue('');

      const memory = buildMergeAgentMemory('/tmp/test');
      expect(memory).toContain('# Merge-Agent Session Memory');
      expect(memory).toContain('Last 20 merges');
    });

    it('should use default tiers when not specified', () => {
      mockExecSync.mockReturnValue('');

      buildMergeAgentMemory('/tmp/test');

      // Should have called git log with max of default tiers
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-n 100'),
        expect.anything()
      );
    });
  });

  describe('rotateSpecialistSession', () => {
    it('should return error when no runtime found', async () => {
      mockGetRuntimeForAgent.mockReturnValue(null);

      const result = await rotateSpecialistSession('merge-agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No runtime found');
    });

    it('should return error when no session ID found', async () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => null,
      } as any);
      mockGetAgentState.mockReturnValue(null);

      const result = await rotateSpecialistSession('merge-agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No session ID found');
    });

    it('should successfully rotate session with memory file', async () => {
      const mockRuntime = {
        name: 'test-runtime',
        getTokenUsage: () => ({ inputTokens: 120000, outputTokens: 30000 }),
        spawnAgent: vi.fn().mockReturnValue({ sessionId: 'new-session-123' }),
      };
      mockGetRuntimeForAgent.mockReturnValue(mockRuntime as any);
      mockGetAgentState.mockReturnValue({
        sessionId: 'old-session-456',
        workspace: '/tmp/workspace',
      } as any);

      // Mock git commands for memory building
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log')) return '';
        if (cmd.includes('tmux kill-session')) return '';
        return '';
      });

      const result = await rotateSpecialistSession('merge-agent', '/tmp/workspace');

      expect(result.success).toBe(true);
      expect(result.oldSessionId).toBe('old-session-456');
      expect(result.newSessionId).toBe('new-session-123');
      expect(mockRuntime.spawnAgent).toHaveBeenCalled();
    });

    it('should handle tmux kill failure gracefully', async () => {
      const mockRuntime = {
        name: 'test-runtime',
        getTokenUsage: () => ({ inputTokens: 120000, outputTokens: 30000 }),
        spawnAgent: vi.fn().mockReturnValue({ sessionId: 'new-session-789' }),
      };
      mockGetRuntimeForAgent.mockReturnValue(mockRuntime as any);
      mockGetAgentState.mockReturnValue({
        sessionId: 'old-session',
        workspace: '/tmp/workspace',
      } as any);

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('tmux kill-session')) {
          throw new Error('session not found');
        }
        if (cmd.includes('git log')) return '';
        return '';
      });

      const result = await rotateSpecialistSession('merge-agent', '/tmp/workspace');

      // Should still succeed even if tmux kill fails
      expect(result.success).toBe(true);
    });
  });

  describe('checkAndRotateIfNeeded', () => {
    it('should return null when rotation not needed', async () => {
      mockGetRuntimeForAgent.mockReturnValue({
        getTokenUsage: () => ({ inputTokens: 40000, outputTokens: 40000 }),
      } as any);

      const result = await checkAndRotateIfNeeded('merge-agent');

      expect(result).toBeNull();
    });

    it('should rotate when needed', async () => {
      const mockRuntime = {
        name: 'test-runtime',
        getTokenUsage: () => ({ inputTokens: 80000, outputTokens: 30000 }),
        spawnAgent: vi.fn().mockReturnValue({ sessionId: 'new-session' }),
      };
      mockGetRuntimeForAgent.mockReturnValue(mockRuntime as any);
      mockGetAgentState.mockReturnValue({
        sessionId: 'old-session',
        workspace: '/tmp/workspace',
      } as any);
      mockExecSync.mockReturnValue('');

      const result = await checkAndRotateIfNeeded('merge-agent', '/tmp/workspace');

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });
  });
});
