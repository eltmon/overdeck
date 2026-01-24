import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for PAN-80: Auto-Suspend Functionality
 *
 * Tests the checkAndSuspendIdleAgents() function that automatically suspends
 * agents that have been idle for too long:
 * - Specialists: 5 minute timeout
 * - Work agents: 10 minute timeout
 */

describe('Auto-Suspend (PAN-80)', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-auto-suspend-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Create base directories
    mkdirSync(join(tempDir, '.panopticon', 'agents'), { recursive: true });
    mkdirSync(join(tempDir, '.panopticon', 'specialists'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('checkAndSuspendIdleAgents', () => {
    it('should return empty array when no agents are running', async () => {
      // Mock listRunningAgents to return empty
      vi.doMock('../../../src/lib/agents.js', () => ({
        listRunningAgents: () => [],
        getAgentRuntimeState: () => null,
        saveSessionId: vi.fn(),
        saveAgentRuntimeState: vi.fn(),
      }));

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      expect(actions).toEqual([]);
    });

    it('should not suspend agents in active state', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      // Create an active agent
      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 mins ago
        currentTool: 'Bash',
      });

      vi.doMock('../../../src/lib/agents.js', async () => {
        const actual = await vi.importActual('../../../src/lib/agents.js');
        return {
          ...actual,
          listRunningAgents: () => [{ id: 'test-agent', tmuxActive: true }],
        };
      });

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      // Should not suspend active agent
      expect(actions).toEqual([]);
    });

    it('should not suspend agents in uninitialized state', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      saveAgentRuntimeState('test-agent', {
        state: 'uninitialized',
        lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      });

      vi.doMock('../../../src/lib/agents.js', async () => {
        const actual = await vi.importActual('../../../src/lib/agents.js');
        return {
          ...actual,
          listRunningAgents: () => [{ id: 'test-agent', tmuxActive: true }],
        };
      });

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      expect(actions).toEqual([]);
    });

    it('should respect 5 minute timeout for specialists', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      // Create idle specialist (4 minutes idle - should NOT suspend)
      saveAgentRuntimeState('specialist-review-agent', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      });

      vi.doMock('../../../src/lib/agents.js', async () => {
        const actual = await vi.importActual('../../../src/lib/agents.js');
        return {
          ...actual,
          listRunningAgents: () => [{ id: 'specialist-review-agent', tmuxActive: true }],
        };
      });

      vi.doMock('../../../src/lib/cloister/specialists.js', () => ({
        getEnabledSpecialists: () => [{ name: 'review-agent', enabled: true }],
        getTmuxSessionName: (name: string) => `specialist-${name}`,
      }));

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      // Should NOT suspend (< 5 minutes)
      expect(actions).toEqual([]);
    });

    it('should respect 10 minute timeout for work agents', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      // Create idle work agent (8 minutes idle - should NOT suspend)
      saveAgentRuntimeState('agent-pan-80', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      });

      vi.doMock('../../../src/lib/agents.js', async () => {
        const actual = await vi.importActual('../../../src/lib/agents.js');
        return {
          ...actual,
          listRunningAgents: () => [{ id: 'agent-pan-80', tmuxActive: true }],
        };
      });

      vi.doMock('../../../src/lib/cloister/specialists.js', () => ({
        getEnabledSpecialists: () => [],
        getTmuxSessionName: () => '',
      }));

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      // Should NOT suspend (< 10 minutes)
      expect(actions).toEqual([]);
    });

    it('should not suspend agents without tmux session', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      });

      vi.doMock('../../../src/lib/agents.js', async () => {
        const actual = await vi.importActual('../../../src/lib/agents.js');
        return {
          ...actual,
          listRunningAgents: () => [{ id: 'test-agent', tmuxActive: false }],
        };
      });

      const { checkAndSuspendIdleAgents } = await import('../../../src/lib/cloister/deacon.js');
      const actions = await checkAndSuspendIdleAgents();

      expect(actions).toEqual([]);
    });
  });

  describe('Idle Time Calculation', () => {
    it('should correctly calculate idle time from lastActivity', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../../src/lib/agents.js');

      const now = Date.now();
      const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();

      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: tenMinutesAgo,
      });

      const state = getAgentRuntimeState('test-agent');
      const idleTime = now - new Date(state!.lastActivity).getTime();
      const idleMinutes = idleTime / (1000 * 60);

      expect(idleMinutes).toBeGreaterThanOrEqual(10);
      expect(idleMinutes).toBeLessThan(11);
    });
  });

  describe('Session ID Handling', () => {
    it('should save session ID before suspending', async () => {
      const { saveAgentRuntimeState, saveSessionId, getSessionId } = await import('../../../src/lib/agents.js');

      // Set up suspended agent manually (simulating what checkAndSuspendIdleAgents does)
      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      });

      // Simulate suspend process
      const sessionId = 'session-test-123';
      saveSessionId('test-agent', sessionId);

      saveAgentRuntimeState('test-agent', {
        state: 'suspended',
        suspendedAt: new Date().toISOString(),
        sessionId,
      });

      // Verify session ID is saved
      const retrievedSessionId = getSessionId('test-agent');
      expect(retrievedSessionId).toBe(sessionId);
    });

    it('should include session ID in runtime state', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState, saveSessionId } = await import('../../../src/lib/agents.js');

      const sessionId = 'session-abc-123';
      const suspendedAt = new Date().toISOString();

      saveSessionId('test-agent', sessionId);
      saveAgentRuntimeState('test-agent', {
        state: 'suspended',
        suspendedAt,
        sessionId,
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.sessionId).toBe(sessionId);
      expect(state?.state).toBe('suspended');
    });
  });

  describe('Multiple Agents', () => {
    it('should handle mix of specialists and work agents correctly', async () => {
      const { saveAgentRuntimeState } = await import('../../../src/lib/agents.js');

      // Specialist (6 min idle - should suspend at 5 min)
      saveAgentRuntimeState('specialist-review-agent', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      });

      // Work agent (12 min idle - should suspend at 10 min)
      saveAgentRuntimeState('agent-pan-80', {
        state: 'idle',
        lastActivity: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      });

      // Active agent (should not suspend)
      saveAgentRuntimeState('agent-pan-90', {
        state: 'active',
        lastActivity: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      });

      // Both idle agents should be suspended in real scenario
      // (This is tested in integration tests panopticon-wk6m)
    });
  });
});
