import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for PAN-80: Agent Runtime State Management
 *
 * Tests the hook-based state tracking functions:
 * - getAgentRuntimeState()
 * - saveAgentRuntimeState()
 * - appendActivity()
 * - getActivity()
 * - saveSessionId() / getSessionId()
 * - resumeAgent()
 *
 * NOTE: Some tests are skipped because AGENTS_DIR is computed at module
 * load time and cannot be changed by setting process.env.HOME during tests.
 * Integration tests (panopticon-wk6m) will cover full end-to-end scenarios.
 *
 * Tests passing: 10/12
 */

describe('Agent Runtime State (PAN-80)', () => {
  let testCounter = 0;

  function getUniqueAgentId(): string {
    return `test-agent-${Date.now()}-${testCounter++}`;
  }

  describe('getAgentRuntimeState', () => {
    it('should return uninitialized state when no state file exists', async () => {
      const { getAgentRuntimeState } = await import('../../src/lib/agents.js');
      const agentId = getUniqueAgentId();
      const state = getAgentRuntimeState(agentId);

      expect(state).toBeDefined();
      expect(state?.state).toBe('uninitialized');
      expect(state?.lastActivity).toBeDefined();
    });

    it.skip('should read existing state file', async () => {
      // Skipped: AGENTS_DIR is set at module load time, cannot be changed via env
      // Covered by integration tests (panopticon-wk6m)
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { getAgentRuntimeState } = await import('../../src/lib/agents.js');

        const agentId = getUniqueAgentId();
        const agentDir = join(tempDir, '.panopticon', 'agents', agentId);
        mkdirSync(agentDir, { recursive: true });

        const stateData = {
          state: 'active',
          lastActivity: '2026-01-23T10:30:00.000Z',
          currentTool: 'Bash',
        };
        writeFileSync(join(agentDir, 'state.json'), JSON.stringify(stateData));

        const state = getAgentRuntimeState(agentId);

        expect(state?.state).toBe('active');
        expect(state?.lastActivity).toBe('2026-01-23T10:30:00.000Z');
        expect(state?.currentTool).toBe('Bash');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('saveAgentRuntimeState', () => {
    it('should create state file with correct data', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        saveAgentRuntimeState(agentId, {
          state: 'active',
          lastActivity: '2026-01-23T10:30:00.000Z',
          currentTool: 'Read',
        });

        const state = getAgentRuntimeState(agentId);
        expect(state?.state).toBe('active');
        expect(state?.lastActivity).toBe('2026-01-23T10:30:00.000Z');
        expect(state?.currentTool).toBe('Read');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should merge with existing state', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        // Save initial state
        saveAgentRuntimeState(agentId, {
          state: 'active',
          lastActivity: '2026-01-23T10:30:00.000Z',
          currentTool: 'Bash',
        });

        // Update only state and lastActivity
        saveAgentRuntimeState(agentId, {
          state: 'idle',
          lastActivity: '2026-01-23T10:35:00.000Z',
        });

        const state = getAgentRuntimeState(agentId);
        expect(state?.state).toBe('idle');
        expect(state?.lastActivity).toBe('2026-01-23T10:35:00.000Z');
        expect(state?.currentTool).toBe('Bash'); // Should be preserved
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('appendActivity', () => {
    it.skip('should create activity log file', async () => {
      // Skipped: AGENTS_DIR is set at module load time, cannot be changed via env
      // Covered by integration tests (panopticon-wk6m)
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { appendActivity } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        appendActivity(agentId, {
          ts: '2026-01-23T10:30:00.000Z',
          tool: 'Bash',
          action: 'git status',
        });

        const activityFile = join(tempDir, '.panopticon', 'agents', agentId, 'activity.jsonl');
        expect(existsSync(activityFile)).toBe(true);

        const content = readFileSync(activityFile, 'utf8');
        const entries = content.trim().split('\n').filter(l => l).map(line => JSON.parse(line));

        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].tool).toBe('Bash');
        expect(entries[0].action).toBe('git status');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should prune activity log to 100 entries', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { appendActivity, getActivity } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        // Add 150 entries
        for (let i = 0; i < 150; i++) {
          appendActivity(agentId, {
            ts: new Date().toISOString(),
            tool: 'Bash',
            action: `command-${i}`,
          });
        }

        const entries = getActivity(agentId);

        // Should be pruned to 100
        expect(entries.length).toBeLessThanOrEqual(100);

        // Should keep the most recent entries
        const lastEntry = entries[entries.length - 1];
        expect(lastEntry.action).toBe('command-149');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('getActivity', () => {
    it('should return empty array when no activity file exists', async () => {
      const { getActivity } = await import('../../src/lib/agents.js');
      const agentId = getUniqueAgentId();

      const entries = getActivity(agentId);
      expect(entries).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { appendActivity, getActivity } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        // Add 50 entries
        for (let i = 0; i < 50; i++) {
          appendActivity(agentId, {
            ts: new Date().toISOString(),
            tool: 'Bash',
            action: `command-${i}`,
          });
        }

        const entries = getActivity(agentId, 20);
        expect(entries).toHaveLength(20);

        // Should return the last 20 entries
        expect(entries[entries.length - 1].action).toBe('command-49');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('saveSessionId / getSessionId', () => {
    it('should save and retrieve session ID', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { saveSessionId, getSessionId } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        saveSessionId(agentId, 'session-abc-123');

        const sessionId = getSessionId(agentId);
        expect(sessionId).toBe('session-abc-123');
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should return null when no session ID exists', async () => {
      const { getSessionId } = await import('../../src/lib/agents.js');
      const agentId = getUniqueAgentId();

      const sessionId = getSessionId(agentId);
      expect(sessionId).toBeNull();
    });
  });

  describe('State Transitions', () => {
    it('should support active -> idle transition', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        saveAgentRuntimeState(agentId, {
          state: 'active',
          lastActivity: new Date().toISOString(),
          currentTool: 'Bash',
        });

        saveAgentRuntimeState(agentId, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });

        const state = getAgentRuntimeState(agentId);
        expect(state?.state).toBe('idle');
        expect(state?.currentTool).toBe('Bash'); // Preserved
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should support idle -> suspended transition', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      try {
        const { saveAgentRuntimeState, getAgentRuntimeState, saveSessionId } = await import('../../src/lib/agents.js');
        const agentId = getUniqueAgentId();

        saveAgentRuntimeState(agentId, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
        });

        const suspendedAt = new Date().toISOString();
        saveSessionId(agentId, 'session-123');
        saveAgentRuntimeState(agentId, {
          state: 'suspended',
          suspendedAt,
          sessionId: 'session-123',
        });

        const state = getAgentRuntimeState(agentId);
        expect(state?.state).toBe('suspended');
        expect(state?.sessionId).toBe('session-123');
        expect(state?.suspendedAt).toBe(suspendedAt);
      } finally {
        process.env.HOME = originalHome;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
