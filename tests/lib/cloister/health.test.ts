/**
 * Tests for Cloister health evaluation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateHealthState,
  getAgentHealth,
  getMultipleAgentHealth,
  generateHealthSummary,
  needsAttention,
  shouldPoke,
  shouldKill,
  getAgentsNeedingAttention,
  getAgentsToPoke,
  getAgentsToKill,
  formatDuration,
  getHealthEmoji,
  getHealthLabel,
  type AgentHealth,
} from '../../../src/lib/cloister/health.js';
import type { AgentRuntime, Heartbeat } from '../../../src/lib/runtimes/types.js';

// Mock runtime for testing
class MockRuntime implements AgentRuntime {
  readonly name = 'test' as const;
  private heartbeats: Map<string, Heartbeat> = new Map();
  private runningAgents: Set<string> = new Set();

  setHeartbeat(agentId: string, heartbeat: Heartbeat): void {
    this.heartbeats.set(agentId, heartbeat);
    this.runningAgents.add(agentId);
  }

  setRunning(agentId: string, running: boolean): void {
    if (running) {
      this.runningAgents.add(agentId);
    } else {
      this.runningAgents.delete(agentId);
    }
  }

  getSessionPath(_agentId: string): string | null {
    return '/mock/session/path';
  }

  getLastActivity(_agentId: string): Date | null {
    return new Date();
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    return this.heartbeats.get(agentId) || null;
  }

  getTokenUsage(_agentId: string): any {
    return null;
  }

  getSessionCost(_agentId: string): any {
    return null;
  }

  sendMessage(_agentId: string, _message: string): void {
    // Mock implementation
  }

  killAgent(_agentId: string): void {
    // Mock implementation
  }

  spawnAgent(_config: any): any {
    // Mock implementation
    return null;
  }

  listSessions(_workspace?: string): any[] {
    return [];
  }

  isRunning(agentId: string): boolean {
    return this.runningAgents.has(agentId);
  }
}

describe('Cloister Health Evaluator', () => {
  describe('evaluateHealthState', () => {
    const thresholds = {
      stale: 5 * 60 * 1000, // 5 minutes
      warning: 15 * 60 * 1000, // 15 minutes
      stuck: 30 * 60 * 1000, // 30 minutes
    };

    it('should return active for recent activity', () => {
      const state = evaluateHealthState(2 * 60 * 1000, thresholds); // 2 minutes
      expect(state).toBe('active');
    });

    it('should return stale for moderately old activity', () => {
      const state = evaluateHealthState(10 * 60 * 1000, thresholds); // 10 minutes
      expect(state).toBe('stale');
    });

    it('should return warning for old activity', () => {
      const state = evaluateHealthState(20 * 60 * 1000, thresholds); // 20 minutes
      expect(state).toBe('warning');
    });

    it('should return stuck for very old activity', () => {
      const state = evaluateHealthState(45 * 60 * 1000, thresholds); // 45 minutes
      expect(state).toBe('stuck');
    });

    it('should handle edge cases at exact thresholds', () => {
      expect(evaluateHealthState(5 * 60 * 1000, thresholds)).toBe('stale');
      expect(evaluateHealthState(15 * 60 * 1000, thresholds)).toBe('warning');
      expect(evaluateHealthState(30 * 60 * 1000, thresholds)).toBe('stuck');
    });
  });

  describe('getAgentHealth', () => {
    let mockRuntime: MockRuntime;
    const thresholds = {
      stale: 5 * 60 * 1000,
      warning: 15 * 60 * 1000,
      stuck: 30 * 60 * 1000,
    };

    beforeEach(() => {
      mockRuntime = new MockRuntime();
    });

    it('should return stuck state for non-running agent', () => {
      mockRuntime.setRunning('agent-1', false);
      const health = getAgentHealth('agent-1', mockRuntime, thresholds);

      expect(health.agentId).toBe('agent-1');
      expect(health.state).toBe('stuck');
      expect(health.isRunning).toBe(false);
      expect(health.lastActivity).toBeNull();
      expect(health.timeSinceActivity).toBeNull();
    });

    it('should return active state for running agent with no heartbeat', () => {
      mockRuntime.setRunning('agent-1', true);
      const health = getAgentHealth('agent-1', mockRuntime, thresholds);

      expect(health.agentId).toBe('agent-1');
      expect(health.state).toBe('active');
      expect(health.isRunning).toBe(true);
      expect(health.lastActivity).toBeNull();
    });

    it('should return active state for agent with recent heartbeat', () => {
      const now = new Date();
      const recentTimestamp = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago

      mockRuntime.setRunning('agent-1', true);
      mockRuntime.setHeartbeat('agent-1', {
        timestamp: recentTimestamp,
        source: 'jsonl_mtime',
      });

      const health = getAgentHealth('agent-1', mockRuntime, thresholds);

      expect(health.agentId).toBe('agent-1');
      expect(health.state).toBe('active');
      expect(health.isRunning).toBe(true);
      expect(health.lastActivity).toEqual(recentTimestamp);
      expect(health.timeSinceActivity).toBeGreaterThan(0);
    });

    it('should return warning state for agent with old heartbeat', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 20 * 60 * 1000); // 20 minutes ago

      mockRuntime.setRunning('agent-1', true);
      mockRuntime.setHeartbeat('agent-1', {
        timestamp: oldTimestamp,
        source: 'jsonl_mtime',
      });

      const health = getAgentHealth('agent-1', mockRuntime, thresholds);

      expect(health.state).toBe('warning');
      expect(health.isRunning).toBe(true);
    });
  });

  describe('getMultipleAgentHealth', () => {
    let mockRuntime: MockRuntime;
    const thresholds = {
      stale: 5 * 60 * 1000,
      warning: 15 * 60 * 1000,
      stuck: 30 * 60 * 1000,
    };

    beforeEach(() => {
      mockRuntime = new MockRuntime();
    });

    it('should return health for multiple agents', () => {
      const now = new Date();

      mockRuntime.setRunning('agent-1', true);
      mockRuntime.setHeartbeat('agent-1', {
        timestamp: new Date(now.getTime() - 2 * 60 * 1000),
        source: 'jsonl_mtime',
      });

      mockRuntime.setRunning('agent-2', true);
      mockRuntime.setHeartbeat('agent-2', {
        timestamp: new Date(now.getTime() - 20 * 60 * 1000),
        source: 'jsonl_mtime',
      });

      const healths = getMultipleAgentHealth(['agent-1', 'agent-2'], mockRuntime, thresholds);

      expect(healths).toHaveLength(2);
      expect(healths[0].agentId).toBe('agent-1');
      expect(healths[0].state).toBe('active');
      expect(healths[1].agentId).toBe('agent-2');
      expect(healths[1].state).toBe('warning');
    });
  });

  describe('generateHealthSummary', () => {
    it('should generate correct summary from agent healths', () => {
      const healths: AgentHealth[] = [
        {
          agentId: 'agent-1',
          state: 'active',
          lastActivity: new Date(),
          timeSinceActivity: 1000,
          heartbeat: null,
          isRunning: true,
        },
        {
          agentId: 'agent-2',
          state: 'active',
          lastActivity: new Date(),
          timeSinceActivity: 2000,
          heartbeat: null,
          isRunning: true,
        },
        {
          agentId: 'agent-3',
          state: 'stale',
          lastActivity: new Date(),
          timeSinceActivity: 10000,
          heartbeat: null,
          isRunning: true,
        },
        {
          agentId: 'agent-4',
          state: 'warning',
          lastActivity: new Date(),
          timeSinceActivity: 20000,
          heartbeat: null,
          isRunning: true,
        },
        {
          agentId: 'agent-5',
          state: 'stuck',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: false,
        },
      ];

      const summary = generateHealthSummary(healths);

      expect(summary.total).toBe(5);
      expect(summary.active).toBe(2);
      expect(summary.stale).toBe(1);
      expect(summary.warning).toBe(1);
      expect(summary.stuck).toBe(1);
    });

    it('should return empty summary for no agents', () => {
      const summary = generateHealthSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.active).toBe(0);
      expect(summary.stale).toBe(0);
      expect(summary.warning).toBe(0);
      expect(summary.stuck).toBe(0);
    });
  });

  describe('health predicates', () => {
    it('needsAttention should return true for warning and stuck', () => {
      expect(
        needsAttention({
          agentId: 'agent-1',
          state: 'warning',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: true,
        })
      ).toBe(true);

      expect(
        needsAttention({
          agentId: 'agent-2',
          state: 'stuck',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: false,
        })
      ).toBe(true);

      expect(
        needsAttention({
          agentId: 'agent-3',
          state: 'active',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: true,
        })
      ).toBe(false);
    });

    it('shouldPoke should return true only for warning', () => {
      expect(
        shouldPoke({
          agentId: 'agent-1',
          state: 'warning',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: true,
        })
      ).toBe(true);

      expect(
        shouldPoke({
          agentId: 'agent-2',
          state: 'stuck',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: false,
        })
      ).toBe(false);
    });

    it('shouldKill should return true only for stuck', () => {
      expect(
        shouldKill({
          agentId: 'agent-1',
          state: 'stuck',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: false,
        })
      ).toBe(true);

      expect(
        shouldKill({
          agentId: 'agent-2',
          state: 'warning',
          lastActivity: null,
          timeSinceActivity: null,
          heartbeat: null,
          isRunning: true,
        })
      ).toBe(false);
    });
  });

  describe('health filtering', () => {
    const healths: AgentHealth[] = [
      {
        agentId: 'agent-1',
        state: 'active',
        lastActivity: null,
        timeSinceActivity: null,
        heartbeat: null,
        isRunning: true,
      },
      {
        agentId: 'agent-2',
        state: 'stale',
        lastActivity: null,
        timeSinceActivity: null,
        heartbeat: null,
        isRunning: true,
      },
      {
        agentId: 'agent-3',
        state: 'warning',
        lastActivity: null,
        timeSinceActivity: null,
        heartbeat: null,
        isRunning: true,
      },
      {
        agentId: 'agent-4',
        state: 'stuck',
        lastActivity: null,
        timeSinceActivity: null,
        heartbeat: null,
        isRunning: false,
      },
    ];

    it('getAgentsNeedingAttention should filter correctly', () => {
      const needsAttention = getAgentsNeedingAttention(healths);
      expect(needsAttention).toHaveLength(2);
      expect(needsAttention[0].agentId).toBe('agent-3');
      expect(needsAttention[1].agentId).toBe('agent-4');
    });

    it('getAgentsToPoke should filter correctly', () => {
      const toPoke = getAgentsToPoke(healths);
      expect(toPoke).toHaveLength(1);
      expect(toPoke[0].agentId).toBe('agent-3');
    });

    it('getAgentsToKill should filter correctly', () => {
      const toKill = getAgentsToKill(healths);
      expect(toKill).toHaveLength(1);
      expect(toKill[0].agentId).toBe('agent-4');
    });
  });

  describe('formatDuration', () => {
    it('should format durations correctly', () => {
      expect(formatDuration(null)).toBe('unknown');
      expect(formatDuration(30 * 1000)).toBe('30s');
      expect(formatDuration(5 * 60 * 1000)).toBe('5m');
      expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2h');
      expect(formatDuration(3 * 24 * 60 * 60 * 1000)).toBe('3d');
    });

    it('should prefer larger units', () => {
      expect(formatDuration(90 * 1000)).toBe('1m'); // 90 seconds = 1 minute
      expect(formatDuration(90 * 60 * 1000)).toBe('1h'); // 90 minutes = 1 hour
      expect(formatDuration(30 * 60 * 60 * 1000)).toBe('1d'); // 30 hours = 1 day
    });
  });

  describe('getHealthEmoji', () => {
    it('should return correct emoji for each state', () => {
      expect(getHealthEmoji('active')).toBe('🟢');
      expect(getHealthEmoji('stale')).toBe('🟡');
      expect(getHealthEmoji('warning')).toBe('🟠');
      expect(getHealthEmoji('stuck')).toBe('🔴');
    });
  });

  describe('getHealthLabel', () => {
    it('should return correct label for each state', () => {
      expect(getHealthLabel('active')).toBe('Active');
      expect(getHealthLabel('stale')).toBe('Stale');
      expect(getHealthLabel('warning')).toBe('Warning');
      expect(getHealthLabel('stuck')).toBe('Stuck');
    });
  });
});
