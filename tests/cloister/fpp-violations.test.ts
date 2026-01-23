/**
 * Tests for fpp-violations.ts
 */

import { describe, it, expect } from 'vitest';
import {
  hasExceededMaxNudges,
  DEFAULT_FPP_CONFIG,
  type FPPViolation,
} from '../../src/lib/cloister/fpp-violations.js';

describe('fpp-violations', () => {
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
});
