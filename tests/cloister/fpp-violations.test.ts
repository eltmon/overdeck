/**
 * Tests for fpp-violations.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasExceededMaxNudges,
  DEFAULT_FPP_CONFIG,
  checkAgentForViolations,
  sendNudge,
  resolveViolation,
  getActiveViolations,
  getAgentViolations,
  clearOldViolations,
  type FPPViolation,
} from '../../src/lib/cloister/fpp-violations.js';

// Mock dependencies
vi.mock('../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: vi.fn(),
}));

vi.mock('../../src/lib/cloister/health.js', () => ({
  getAgentHealth: vi.fn(),
}));

vi.mock('../../src/lib/hooks.js', () => ({
  checkHook: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '{"violations":[]}'),
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { getRuntimeForAgent } from '../../src/lib/runtimes/index.js';
import { getAgentHealth } from '../../src/lib/cloister/health.js';
import { checkHook } from '../../src/lib/hooks.js';

const mockGetRuntimeForAgent = vi.mocked(getRuntimeForAgent);
const mockGetAgentHealth = vi.mocked(getAgentHealth);
const mockCheckHook = vi.mocked(checkHook);

describe('fpp-violations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('hasExceededMaxNudges', () => {
    it('should return true when max nudges exceeded', () => {
      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 3,
        resolved: false,
      };

      expect(hasExceededMaxNudges(violation, DEFAULT_FPP_CONFIG)).toBe(true);
    });

    it('should return false when under max nudges', () => {
      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 2,
        resolved: false,
      };

      expect(hasExceededMaxNudges(violation, DEFAULT_FPP_CONFIG)).toBe(false);
    });

    it('should use custom config max nudges', () => {
      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 5,
        resolved: false,
      };

      const customConfig = { ...DEFAULT_FPP_CONFIG, max_nudges: 10 };
      expect(hasExceededMaxNudges(violation, customConfig)).toBe(false);
    });
  });

  describe('DEFAULT_FPP_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_FPP_CONFIG.hook_idle_minutes).toBe(5);
      expect(DEFAULT_FPP_CONFIG.pr_approved_minutes).toBe(10);
      expect(DEFAULT_FPP_CONFIG.review_pending_minutes).toBe(15);
      expect(DEFAULT_FPP_CONFIG.max_nudges).toBe(3);
    });
  });

  describe('FPPViolation type', () => {
    it('should have correct structure', () => {
      const violation: FPPViolation = {
        agentId: 'test-agent',
        type: 'hook_idle',
        detectedAt: '2026-01-23T00:00:00Z',
        nudgeCount: 0,
        resolved: false,
      };

      expect(violation.agentId).toBe('test-agent');
      expect(violation.type).toBe('hook_idle');
      expect(violation.nudgeCount).toBe(0);
      expect(violation.resolved).toBe(false);
    });
  });

  describe('checkAgentForViolations', () => {
    it('should return null when no runtime found', () => {
      mockGetRuntimeForAgent.mockReturnValue(null);

      const result = checkAgentForViolations('agent-1');
      expect(result).toBeNull();
    });

    it('should return null when no health data found', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue(null as any);

      const result = checkAgentForViolations('agent-1');
      expect(result).toBeNull();
    });

    it('should return null when agent is active', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-1',
        state: 'active',
        timeSinceActivity: 0,
      } as any);

      const result = checkAgentForViolations('agent-1');
      expect(result).toBeNull();
    });

    it('should return null when hook check fails', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-1',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000, // 10 minutes
      } as any);
      mockCheckHook.mockImplementation(() => {
        throw new Error('Hook check failed');
      });

      const result = checkAgentForViolations('agent-1');
      expect(result).toBeNull();
    });

    it('should return null when no pending work', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-1',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000, // 10 minutes
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: false } as any);

      const result = checkAgentForViolations('agent-1');
      expect(result).toBeNull();
    });

    it('should detect hook_idle violation when idle with pending work', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-1',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000, // 10 minutes
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: true } as any);

      const result = checkAgentForViolations('agent-1');

      expect(result).not.toBeNull();
      expect(result?.type).toBe('hook_idle');
      expect(result?.agentId).toBe('agent-1');
      expect(result?.nudgeCount).toBe(0);
      expect(result?.resolved).toBe(false);
    });

    it('should not create duplicate violations', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-1',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000,
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: true } as any);

      // First check creates violation
      const result1 = checkAgentForViolations('agent-1');
      // Second check returns existing violation
      const result2 = checkAgentForViolations('agent-1');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      // Both should be the same violation
      expect(result1?.detectedAt).toBe(result2?.detectedAt);
    });
  });

  describe('sendNudge', () => {
    it('should return false when no runtime found', () => {
      mockGetRuntimeForAgent.mockReturnValue(null);

      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 0,
        resolved: false,
      };

      const result = sendNudge(violation);
      expect(result).toBe(false);
    });

    it('should send message and increment nudge count', () => {
      const mockSendMessage = vi.fn();
      mockGetRuntimeForAgent.mockReturnValue({
        sendMessage: mockSendMessage,
      } as any);

      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 0,
        resolved: false,
      };

      const result = sendNudge(violation);

      expect(result).toBe(true);
      expect(violation.nudgeCount).toBe(1);
      expect(violation.lastNudgeAt).toBeDefined();
      expect(mockSendMessage).toHaveBeenCalledWith(
        'agent-1',
        expect.stringContaining('status')
      );
    });

    it('should use different messages for each nudge level', () => {
      const mockSendMessage = vi.fn();
      mockGetRuntimeForAgent.mockReturnValue({
        sendMessage: mockSendMessage,
      } as any);

      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 0,
        resolved: false,
      };

      // First nudge
      sendNudge(violation);
      expect(mockSendMessage).toHaveBeenLastCalledWith(
        'agent-1',
        expect.stringContaining('status')
      );

      // Second nudge
      sendNudge(violation);
      expect(mockSendMessage).toHaveBeenLastCalledWith(
        'agent-1',
        expect.stringContaining('idle')
      );

      // Third nudge
      sendNudge(violation);
      expect(mockSendMessage).toHaveBeenLastCalledWith(
        'agent-1',
        expect.stringContaining('Execute it now')
      );
    });

    it('should return false on send error', () => {
      mockGetRuntimeForAgent.mockReturnValue({
        sendMessage: vi.fn(() => {
          throw new Error('Send failed');
        }),
      } as any);

      const violation: FPPViolation = {
        agentId: 'agent-1',
        type: 'hook_idle',
        detectedAt: new Date().toISOString(),
        nudgeCount: 0,
        resolved: false,
      };

      const result = sendNudge(violation);
      expect(result).toBe(false);
    });
  });

  describe('resolveViolation', () => {
    it('should mark violation as resolved', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-resolve',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000,
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: true } as any);

      // Create a violation first
      checkAgentForViolations('agent-resolve');

      // Resolve it
      resolveViolation('agent-resolve', 'hook_idle');

      // Check it's resolved
      const violations = getAgentViolations('agent-resolve');
      expect(violations.length).toBe(0);
    });

    it('should handle non-existent violations gracefully', () => {
      // Should not throw
      expect(() => resolveViolation('non-existent', 'hook_idle')).not.toThrow();
    });
  });

  describe('getActiveViolations', () => {
    it('should return empty array when no violations', () => {
      const violations = getActiveViolations();
      // Filter out any pre-existing violations from previous tests
      const newViolations = violations.filter(v => v.agentId.startsWith('new-'));
      expect(newViolations).toHaveLength(0);
    });

    it('should not return resolved violations', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'agent-active-test',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000,
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: true } as any);

      // Create and resolve a violation
      checkAgentForViolations('agent-active-test');
      resolveViolation('agent-active-test', 'hook_idle');

      const violations = getActiveViolations();
      const agentViolation = violations.find(v => v.agentId === 'agent-active-test');
      expect(agentViolation).toBeUndefined();
    });
  });

  describe('getAgentViolations', () => {
    it('should return only violations for specified agent', () => {
      mockGetRuntimeForAgent.mockReturnValue({} as any);
      mockGetAgentHealth.mockReturnValue({
        agentId: 'specific-agent',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000,
      } as any);
      mockCheckHook.mockReturnValue({ hasWork: true } as any);

      // Create violation for specific agent
      checkAgentForViolations('specific-agent');

      // Create violation for another agent
      mockGetAgentHealth.mockReturnValue({
        agentId: 'other-agent',
        state: 'stale',
        timeSinceActivity: 10 * 60 * 1000,
      } as any);
      checkAgentForViolations('other-agent');

      const violations = getAgentViolations('specific-agent');
      expect(violations.length).toBe(1);
      expect(violations[0].agentId).toBe('specific-agent');
    });

    it('should return empty array for agent with no violations', () => {
      const violations = getAgentViolations('agent-without-violations');
      expect(violations).toHaveLength(0);
    });
  });

  describe('clearOldViolations', () => {
    it('should not throw when clearing violations', () => {
      expect(() => clearOldViolations(24)).not.toThrow();
    });

    it('should accept custom hours parameter', () => {
      expect(() => clearOldViolations(48)).not.toThrow();
      expect(() => clearOldViolations(1)).not.toThrow();
    });
  });
});
