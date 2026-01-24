import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

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
 */

describe('Agent Runtime State (PAN-80)', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let agentModule: any;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-agent-state-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    // Clear module cache to ensure fresh imports
    vi.resetModules();

    // Import fresh module
    agentModule = await import('../../src/lib/agents.js');
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  describe('getAgentRuntimeState', () => {
    it('should return uninitialized state when no state file exists', () => {
      const { getAgentRuntimeState } = agentModule;
      const state = getAgentRuntimeState('test-agent-unique-1');

      expect(state).toBeDefined();
      expect(state?.state).toBe('uninitialized');
      expect(state?.lastActivity).toBeDefined();
    });

    it('should read existing state file', () => {
      const { getAgentRuntimeState } = agentModule;

      // Create state file manually
      const agentDir = join(tempDir, '.panopticon', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });

      const stateData = {
        state: 'active',
        lastActivity: '2026-01-23T10:30:00.000Z',
        currentTool: 'Bash',
      };
      writeFileSync(join(agentDir, 'state.json'), JSON.stringify(stateData));

      const state = getAgentRuntimeState('test-agent');

      expect(state?.state).toBe('active');
      expect(state?.lastActivity).toBe('2026-01-23T10:30:00.000Z');
      expect(state?.currentTool).toBe('Bash');
    });

    it('should handle corrupted state file gracefully', async () => {
      const { getAgentRuntimeState } = await import('../../src/lib/agents.js');

      const agentDir = join(tempDir, '.panopticon', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'state.json'), 'invalid json{');

      // Should not throw, should return uninitialized
      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('uninitialized');
    });
  });

  describe('saveAgentRuntimeState', () => {
    it('should create state file with correct data', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');

      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: '2026-01-23T10:30:00.000Z',
        currentTool: 'Read',
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('active');
      expect(state?.lastActivity).toBe('2026-01-23T10:30:00.000Z');
      expect(state?.currentTool).toBe('Read');
    });

    it('should merge with existing state', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');

      // Save initial state
      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: '2026-01-23T10:30:00.000Z',
        currentTool: 'Bash',
      });

      // Update only state and lastActivity
      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: '2026-01-23T10:35:00.000Z',
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('idle');
      expect(state?.lastActivity).toBe('2026-01-23T10:35:00.000Z');
      expect(state?.currentTool).toBe('Bash'); // Should be preserved
    });

    it('should handle suspended state with session ID', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');

      const suspendedAt = new Date().toISOString();
      saveAgentRuntimeState('test-agent', {
        state: 'suspended',
        lastActivity: suspendedAt,
        sessionId: 'session-123-abc',
        suspendedAt,
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('suspended');
      expect(state?.sessionId).toBe('session-123-abc');
      expect(state?.suspendedAt).toBe(suspendedAt);
    });
  });

  describe('appendActivity', () => {
    it('should create activity log file', async () => {
      const { appendActivity } = await import('../../src/lib/agents.js');

      appendActivity('test-agent', {
        ts: '2026-01-23T10:30:00.000Z',
        tool: 'Bash',
        action: 'git status',
      });

      const activityFile = join(tempDir, '.panopticon', 'agents', 'test-agent', 'activity.jsonl');
      expect(existsSync(activityFile)).toBe(true);

      const content = readFileSync(activityFile, 'utf8');
      const entries = content.trim().split('\n').map(line => JSON.parse(line));

      expect(entries).toHaveLength(1);
      expect(entries[0].tool).toBe('Bash');
      expect(entries[0].action).toBe('git status');
    });

    it('should append to existing activity log', async () => {
      const { appendActivity } = await import('../../src/lib/agents.js');

      appendActivity('test-agent', {
        ts: '2026-01-23T10:30:00.000Z',
        tool: 'Bash',
        action: 'git status',
      });

      appendActivity('test-agent', {
        ts: '2026-01-23T10:31:00.000Z',
        tool: 'Read',
        action: 'src/index.ts',
      });

      const { getActivity } = await import('../../src/lib/agents.js');
      const entries = getActivity('test-agent');

      expect(entries).toHaveLength(2);
      expect(entries[0].tool).toBe('Bash');
      expect(entries[1].tool).toBe('Read');
    });

    it('should prune activity log to 100 entries', async () => {
      const { appendActivity, getActivity } = await import('../../src/lib/agents.js');

      // Add 150 entries
      for (let i = 0; i < 150; i++) {
        appendActivity('test-agent', {
          ts: new Date().toISOString(),
          tool: 'Bash',
          action: `command-${i}`,
        });
      }

      const entries = getActivity('test-agent');

      // Should be pruned to 100
      expect(entries.length).toBeLessThanOrEqual(100);

      // Should keep the most recent entries
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.action).toBe('command-149');
    });
  });

  describe('getActivity', () => {
    it('should return empty array when no activity file exists', async () => {
      const { getActivity } = await import('../../src/lib/agents.js');

      const entries = getActivity('nonexistent-agent');
      expect(entries).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const { appendActivity, getActivity } = await import('../../src/lib/agents.js');

      // Add 50 entries
      for (let i = 0; i < 50; i++) {
        appendActivity('test-agent', {
          ts: new Date().toISOString(),
          tool: 'Bash',
          action: `command-${i}`,
        });
      }

      const entries = getActivity('test-agent', 20);
      expect(entries).toHaveLength(20);

      // Should return the last 20 entries
      expect(entries[entries.length - 1].action).toBe('command-49');
    });

    it('should handle malformed JSONL gracefully', async () => {
      const { getActivity } = await import('../../src/lib/agents.js');

      const agentDir = join(tempDir, '.panopticon', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });

      // Write some valid and invalid lines
      const activityFile = join(agentDir, 'activity.jsonl');
      writeFileSync(activityFile, '{"ts":"2026-01-23T10:30:00.000Z","tool":"Bash"}\ninvalid json\n{"ts":"2026-01-23T10:31:00.000Z","tool":"Read"}\n');

      const entries = getActivity('test-agent');

      // Should skip invalid line
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(e => e.tool)).toBe(true);
    });
  });

  describe('saveSessionId / getSessionId', () => {
    it('should save and retrieve session ID', async () => {
      const { saveSessionId, getSessionId } = await import('../../src/lib/agents.js');

      saveSessionId('test-agent', 'session-abc-123');

      const sessionId = getSessionId('test-agent');
      expect(sessionId).toBe('session-abc-123');
    });

    it('should return null when no session ID exists', async () => {
      const { getSessionId } = await import('../../src/lib/agents.js');

      const sessionId = getSessionId('nonexistent-agent');
      expect(sessionId).toBeNull();
    });

    it('should overwrite existing session ID', async () => {
      const { saveSessionId, getSessionId } = await import('../../src/lib/agents.js');

      saveSessionId('test-agent', 'session-old');
      saveSessionId('test-agent', 'session-new');

      const sessionId = getSessionId('test-agent');
      expect(sessionId).toBe('session-new');
    });
  });

  describe('resumeAgent', () => {
    it('should return error when agent is not suspended', async () => {
      const { resumeAgent, saveAgentRuntimeState } = await import('../../src/lib/agents.js');

      // Set agent to active state
      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: new Date().toISOString(),
      });

      const result = await resumeAgent('test-agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot resume agent in state');
    });

    it('should return error when no session ID is saved', async () => {
      const { resumeAgent, saveAgentRuntimeState } = await import('../../src/lib/agents.js');

      // Set agent to suspended without session ID
      saveAgentRuntimeState('test-agent', {
        state: 'suspended',
        lastActivity: new Date().toISOString(),
        suspendedAt: new Date().toISOString(),
      });

      const result = await resumeAgent('test-agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No saved session ID');
    });

    // Note: Full integration test with tmux would require tmux to be installed
    // and would need mocking. This is covered by integration tests (panopticon-wk6m)
  });

  describe('State Transitions', () => {
    it('should support uninitialized -> active transition', async () => {
      const { getAgentRuntimeState, saveAgentRuntimeState } = await import('../../src/lib/agents.js');

      const initial = getAgentRuntimeState('test-agent');
      expect(initial?.state).toBe('uninitialized');

      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: new Date().toISOString(),
        currentTool: 'Bash',
      });

      const updated = getAgentRuntimeState('test-agent');
      expect(updated?.state).toBe('active');
    });

    it('should support active -> idle transition', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState } = await import('../../src/lib/agents.js');

      saveAgentRuntimeState('test-agent', {
        state: 'active',
        lastActivity: new Date().toISOString(),
        currentTool: 'Bash',
      });

      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('idle');
      expect(state?.currentTool).toBe('Bash'); // Preserved
    });

    it('should support idle -> suspended transition', async () => {
      const { saveAgentRuntimeState, getAgentRuntimeState, saveSessionId } = await import('../../src/lib/agents.js');

      saveAgentRuntimeState('test-agent', {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });

      const suspendedAt = new Date().toISOString();
      saveSessionId('test-agent', 'session-123');
      saveAgentRuntimeState('test-agent', {
        state: 'suspended',
        suspendedAt,
        sessionId: 'session-123',
      });

      const state = getAgentRuntimeState('test-agent');
      expect(state?.state).toBe('suspended');
      expect(state?.sessionId).toBe('session-123');
      expect(state?.suspendedAt).toBe(suspendedAt);
    });
  });
});
