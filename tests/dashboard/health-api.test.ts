/**
 * Tests for dashboard health API filtering
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { determineHealthStatusAsync } from '../../src/dashboard/lib/health-filtering.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'health-api-test-'));
  mkdirSync(join(testDir, '.panopticon', 'agents'), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Helper to create agent directory with state.json
function createAgent(name: string, status?: string, lastActivity?: string): string {
  const agentDir = join(testDir, '.panopticon', 'agents', name);
  mkdirSync(agentDir, { recursive: true });

  if (status !== undefined) {
    const state = {
      status,
      lastActivity: lastActivity || new Date().toISOString(),
    };
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state, null, 2));
  }

  return agentDir;
}

// Helper to create tmux session
function createTmuxSession(name: string): void {
  try {
    execSync(`tmux new-session -d -s "${name}" "sleep 3600"`, { stdio: 'ignore' });
  } catch {
    // Session might already exist
  }
}

// Helper to kill tmux session
function killTmuxSession(name: string): void {
  try {
    execSync(`tmux kill-session -t "${name}"`, { stdio: 'ignore' });
  } catch {
    // Session might not exist
  }
}

describe('health-api', () => {
  describe('agent filtering', () => {
    it('should exclude agents with status "stopped"', async () => {
      const agentDir = createAgent('agent-stopped', 'stopped');

      const result = await determineHealthStatusAsync(
        'agent-stopped',
        join(agentDir, 'state.json')
      );

      expect(result).toBeNull();
    });

    it('should exclude agents with status "completed"', async () => {
      const agentDir = createAgent('agent-completed', 'completed');

      const result = await determineHealthStatusAsync(
        'agent-completed',
        join(agentDir, 'state.json')
      );

      expect(result).toBeNull();
    });

    it('should exclude agents without state.json', async () => {
      const agentDir = createAgent('agent-no-state');
      // Don't create state.json (status param undefined creates dir only)

      const result = await determineHealthStatusAsync(
        'agent-no-state',
        join(agentDir, 'state.json')
      );

      expect(result).toBeNull();
    });

    it('should show crashed agents (status "running", no tmux)', async () => {
      const agentDir = createAgent('agent-crashed', 'running');

      const result = await determineHealthStatusAsync(
        'agent-crashed',
        join(agentDir, 'state.json')
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('dead');
      expect(result?.reason).toBe('Agent crashed unexpectedly');
    });

    it('should show crashed agents (status "in_progress", no tmux)', async () => {
      const agentDir = createAgent('agent-crashed-2', 'in_progress');

      const result = await determineHealthStatusAsync(
        'agent-crashed-2',
        join(agentDir, 'state.json')
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('dead');
      expect(result?.reason).toBe('Agent crashed unexpectedly');
    });

    it('should show healthy running agents with tmux session', async () => {
      const agentName = 'agent-healthy-test';
      const agentDir = createAgent(agentName, 'running');
      createTmuxSession(agentName);

      try {
        const result = await determineHealthStatusAsync(
          agentName,
          join(agentDir, 'state.json')
        );

        expect(result).not.toBeNull();
        expect(result?.status).toBe('healthy');
        expect(result?.reason).toBeUndefined();
      } finally {
        killTmuxSession(agentName);
      }
    });

    it('should show warning for agents with 15-30 min inactivity', async () => {
      const agentName = 'agent-warning-test';
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const agentDir = createAgent(agentName, 'running', twentyMinutesAgo);
      createTmuxSession(agentName);

      try {
        const result = await determineHealthStatusAsync(
          agentName,
          join(agentDir, 'state.json')
        );

        expect(result).not.toBeNull();
        expect(result?.status).toBe('warning');
        expect(result?.reason).toContain('Low activity');
      } finally {
        killTmuxSession(agentName);
      }
    });

    it('should show stuck for agents with >30 min inactivity', async () => {
      const agentName = 'agent-stuck-test';
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      const agentDir = createAgent(agentName, 'running', fortyMinutesAgo);
      createTmuxSession(agentName);

      try {
        const result = await determineHealthStatusAsync(
          agentName,
          join(agentDir, 'state.json')
        );

        expect(result).not.toBeNull();
        expect(result?.status).toBe('stuck');
        expect(result?.reason).toContain('No activity for');
      } finally {
        killTmuxSession(agentName);
      }
    });

    it('should handle corrupted state.json gracefully', async () => {
      const agentDir = createAgent('agent-corrupted-state');
      writeFileSync(join(agentDir, 'state.json'), 'not valid json{{{');

      const result = await determineHealthStatusAsync(
        'agent-corrupted-state',
        join(agentDir, 'state.json')
      );

      // Corrupted state.json treated as missing -> excluded
      expect(result).toBeNull();
    });

    it('should treat unknown status values as running (crash if no tmux)', async () => {
      const agentDir = createAgent('agent-unknown-status', 'weird_status_value');

      const result = await determineHealthStatusAsync(
        'agent-unknown-status',
        join(agentDir, 'state.json')
      );

      // Unknown status + no tmux = treat as crashed
      expect(result).not.toBeNull();
      expect(result?.status).toBe('dead');
    });
  });
});
